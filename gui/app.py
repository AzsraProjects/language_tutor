"""Desktop app entry point: a native window (pywebview) on top of the tutor engine."""

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

# Make `import tutor` and `import gui` work when run as a script from the repo.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import webview  # noqa: E402

from gui import audio, config, ollama_mgr, paths, progress, stt, updater  # noqa: E402
from gui.engine import Engine  # noqa: E402
from gui.version import APP_NAME  # noqa: E402


def _safe(method):
    """Turn any exception of an API method into {ok: False, error} for the UI."""

    def wrapper(self, *args):
        try:
            result = method(self, *args)
        except Exception as error:  # noqa: BLE001 - the interface shows the message
            return {"ok": False, "error": str(error)}
        return result if result is not None else {"ok": True}

    wrapper.__name__ = method.__name__
    return wrapper


class Api:
    """Methods callable from the interface as window.pywebview.api.<name>()."""

    def __init__(self):
        self._window = None
        self._engine = Engine(self._emit)
        self._pending_update = None

    def _attach(self, window) -> None:
        self._window = window

    def _emit(self, event: dict) -> None:
        if self._window is None:
            return
        payload = json.dumps(event, ensure_ascii=False)
        try:
            self._window.evaluate_js(f"window.LT && window.LT.onEvent({payload})")
        except Exception:  # noqa: BLE001 - the window may be closing
            pass

    def _background(self, target) -> None:
        threading.Thread(target=target, daemon=True).start()

    # --- State and settings -----------------------------------------------------

    @_safe
    def get_state(self):
        return self._engine.state()

    @_safe
    def recheck_setup(self):
        return self._engine.state()

    @_safe
    def set_language(self, code):
        config.update({"language": code})
        return self._engine.state()

    @_safe
    def save_settings(self, changes):
        changes = dict(changes or {})
        if not changes.get("api_key"):
            changes.pop("api_key", None)
        config.update(changes)
        return self._engine.state()

    @_safe
    def list_mics(self):
        return {"ok": True, "mics": audio.list_microphones()}

    @_safe
    def list_models(self):
        return {"ok": True, "models": ollama_mgr.models()}

    # --- Setup --------------------------------------------------------------------

    @_safe
    def setup_action(self, step):
        settings = config.load()

        def progress_cb(pct, label):
            self._emit(
                {"type": "setup_progress", "step": step, "pct": pct, "label": label}
            )

        def run():
            try:
                if step == "install_ollama":
                    ollama_mgr.install(progress_cb)
                    progress_cb(None, "Démarrage d'Ollama…")
                    ollama_mgr.start(wait_seconds=40)
                elif step == "start_ollama":
                    progress_cb(None, "Démarrage d'Ollama…")
                    if not ollama_mgr.start():
                        raise RuntimeError("Ollama n'a pas démarré.")
                elif step == "pull_model":
                    ollama_mgr.pull(settings["model"], progress_cb)
                elif step == "download_whisper_model":
                    stt.download_model(
                        settings["whisper_model"],
                        lambda done, total: progress_cb(
                            int(done * 100 / total) if total else None,
                            "Téléchargement du modèle de transcription…",
                        ),
                    )
                elif step == "download_whisper_bin":
                    raise RuntimeError(
                        "Le moteur de transcription est fourni avec l'appli : réinstalle-la."
                    )
                else:
                    raise RuntimeError(f"Étape inconnue : {step}")
            except Exception as error:  # noqa: BLE001 - reported to the interface
                self._emit(
                    {
                        "type": "setup_done",
                        "step": step,
                        "ok": False,
                        "error": str(error),
                    }
                )
            else:
                self._emit({"type": "setup_done", "step": step, "ok": True})

        self._background(run)

    # --- Session ------------------------------------------------------------------

    @_safe
    def start_session(self, followup=False):
        return self._engine.start_session(bool(followup))

    @_safe
    def start_recording(self):
        self._engine.start_recording()

    @_safe
    def stop_recording(self):
        self._engine.stop_recording()

    @_safe
    def cancel_recording(self):
        self._engine.cancel_recording()

    @_safe
    def toggle_challenge(self, challenge_id):
        language = config.load()["language"]
        challenges, gained = progress.toggle_challenge(language, challenge_id)
        return {
            "ok": True,
            "challenges": challenges,
            "progress": progress.snapshot(language),
            "xp_gained": gained,
        }

    @_safe
    def request_feedback(self):
        self._engine.request_feedback()

    @_safe
    def end_session(self):
        self._engine.end_session()
        return self._engine.state()

    # --- Files ----------------------------------------------------------------------

    @staticmethod
    def _open(path: Path) -> None:
        if paths.IS_WINDOWS:
            os.startfile(str(path))  # noqa: S606 - opening the user's own folder/file
        else:
            subprocess.Popen(["xdg-open", str(path)])

    @_safe
    def open_logs_folder(self):
        self._open(paths.logs_root())

    @_safe
    def open_feedback_file(self):
        path = self._engine.feedback_file()
        if path is None or not path.exists():
            raise RuntimeError("Aucun bilan à ouvrir pour l'instant.")
        self._open(path)

    # --- Updates ----------------------------------------------------------------------

    @_safe
    def check_update(self):
        found = updater.check()
        self._pending_update = found
        self._engine.update_info = found
        public = (
            {"version": found["version"], "notes": found["notes"]} if found else None
        )
        return {"ok": True, "update": public}

    @_safe
    def install_update(self):
        update = self._pending_update or updater.check()
        if update is None:
            raise RuntimeError("L'appli est déjà à jour.")

        def run():
            try:
                self._emit(
                    {"type": "update_progress", "pct": 0, "label": "Téléchargement…"}
                )
                asset = updater.download(
                    update,
                    lambda pct: self._emit(
                        {
                            "type": "update_progress",
                            "pct": pct,
                            "label": "Téléchargement…",
                        }
                    ),
                )
                self._emit(
                    {"type": "update_progress", "pct": 100, "label": "Installation…"}
                )
                self._engine.end_session()
                updater.apply(asset)
            except Exception as error:  # noqa: BLE001 - reported to the interface
                self._emit({"type": "update_error", "message": str(error)})
                return
            if self._window is not None:
                self._window.destroy()

        self._background(run)

    def _startup_update_check(self) -> None:
        try:
            found = updater.check()
        except Exception:  # noqa: BLE001 - offline or rate-limited: not an error for the user
            return
        self._pending_update = found
        self._engine.update_info = found
        if found:
            self._emit(
                {
                    "type": "update_available",
                    "version": found["version"],
                    "notes": found["notes"],
                }
            )


def _self_test(window) -> None:
    """Packaging smoke test: with LANGUAGE_TUTOR_SELFTEST=<file>, write what the
    window shows after start to that file and quit."""
    target = os.getenv("LANGUAGE_TUTOR_SELFTEST")
    if not target:
        return
    import time

    time.sleep(4)
    try:
        shown = window.evaluate_js("document.getElementById('app').innerText")
    except Exception as error:  # noqa: BLE001 - the report is the point of the test
        shown = f"evaluate_js failed: {error}"
    Path(target).write_text(str(shown), encoding="utf-8")
    window.destroy()


def main() -> None:
    api = Api()
    index = paths.web_dir() / "index.html"
    window = webview.create_window(
        APP_NAME,
        url=str(index),
        js_api=api,
        width=1240,
        height=840,
        min_size=(900, 640),
        background_color="#FFFFFF",
    )
    api._attach(window)

    def on_start():
        # Ollama may be installed but not started yet: start it quietly.
        if config.load()["api"] == "ollama" and not ollama_mgr.running():
            ollama_mgr.start(wait_seconds=8)
        api._startup_update_check()
        _self_test(window)

    def on_closing():
        api._engine.end_session()

    window.events.closing += on_closing
    webview.start(on_start, debug=bool(os.getenv("LANGUAGE_TUTOR_DEBUG")))


if __name__ == "__main__":
    main()
