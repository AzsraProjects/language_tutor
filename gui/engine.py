"""Session engine of the desktop app.

It drives the classes of the command-line tutor (tutor.py) exactly as its
`main()` does - same prompts, same follow-up logic, same log files - and
replaces only the terminal input/output with events for the interface.
"""

import os
import tempfile
import threading
import time
from pathlib import Path

import tutor
from gui import (
    audio,
    config,
    curriculum,
    lessons,
    ollama_mgr,
    paths,
    progress,
    stt,
    tts,
)


def _mic_id(value):
    """Stored microphone choice as a PortAudio device index (None = default)."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class Engine:
    def __init__(self, emit):
        self._emit = emit
        self._lock = threading.RLock()
        self._session = None
        self._recorder = None
        self._busy = False
        self.update_info = None

    # --- State ----------------------------------------------------------------

    def setup_status(self, settings: dict) -> dict:
        local = settings["api"] == "ollama"
        is_running = ollama_mgr.running() if local else False
        installed = is_running or ollama_mgr.executable() is not None
        if local:
            model_ok = is_running and ollama_mgr.has_model(settings["model"])
        else:
            model_ok = bool(settings["api_key"]) and bool(settings["model"])
        status = {
            "needs_ollama": local,
            "ollama_installed": installed if local else True,
            "ollama_running": is_running if local else True,
            "model_ok": model_ok,
            "whisper_bin_ok": paths.whisper_binary() is not None,
            "whisper_model_ok": stt.model_ready(settings["whisper_model"]),
            "mic_ok": bool(audio.list_microphones()),
            "platform": "windows" if paths.IS_WINDOWS else "linux",
        }
        status["ready"] = all(
            status[key]
            for key in (
                "ollama_installed",
                "ollama_running",
                "model_ok",
                "whisper_bin_ok",
                "whisper_model_ok",
                "mic_ok",
            )
        )
        return status

    def _session_public(self) -> dict | None:
        session = self._session
        if session is None:
            return None
        return {
            "number": session["number"],
            "followup": session["followup"],
            "replies": session["replies"],
            "goal": session["goal"],
            "turns": list(session["turns"]),
            "feedback_done": session["feedback_done"],
        }

    def state(self) -> dict:
        from gui.version import VERSION

        settings = config.load()
        language = settings["language"]
        language_name = tutor.LANGUAGE_MAP[language]
        snapshot = progress.snapshot(language)
        briefing = tutor.find_latest_briefing_file(
            paths.logs_root() / language, language_name
        )
        update = self.update_info
        return {
            "ok": True,
            "version": VERSION,
            "language": language,
            "languages": [
                {"code": c, "name": n} for c, n in tutor.LANGUAGE_MAP.items()
            ],
            "settings": config.public(settings),
            "setup": self.setup_status(settings),
            "progress": snapshot,
            "next_session_number": snapshot["sessions_done"] + 1,
            "challenges": progress.challenges(language),
            "has_briefing": briefing is not None,
            "levels": curriculum.LEVELS,
            "level": lessons.level(language),
            "path": lessons.path_state(language),
            "voice": tts.available(language),
            "voice_offer": {
                "supported": tts.supported(language),
                "megabytes": round(tts.download_size(language) / 1_000_000),
            },
            "session": self._session_public(),
            "update": {"version": update["version"], "notes": update["notes"]}
            if update
            else None,
        }

    # --- Session lifecycle ------------------------------------------------------

    def start_session(self, followup: bool) -> dict:
        with self._lock:
            if self._session is not None:
                self.end_session()
            settings = config.load()
            language = settings["language"]
            language_name = tutor.LANGUAGE_MAP[language]
            logs_dir = paths.logs_root() / language

            # tutor.EnglishTutor reads its connection settings from the environment.
            os.environ["BASE_URL"] = settings["base_url"] or config.DEFAULTS["base_url"]
            os.environ["API_KEY"] = settings["api_key"] or ""

            tutor_prompt = tutor.load_prompt(
                paths.prompt_path("tutor_system_prompt.txt"), "Tutor system prompt"
            )
            feedback_prompt = tutor.load_prompt(
                paths.prompt_path("feedback_system_prompt.txt"),
                "Feedback system prompt",
            )
            final_prompt = tutor_prompt.replace("{%language%}", language_name)
            final_feedback_prompt = feedback_prompt.replace(
                "{%language%}", language_name
            )

            previous_notes = None
            if followup:
                briefing_path = tutor.find_latest_briefing_file(logs_dir, language_name)
                if briefing_path is not None:
                    text = briefing_path.read_text(encoding="utf-8")
                    previous_notes = tutor.extract_briefing(text) or None
                if previous_notes:
                    final_prompt += "\n\n" + tutor.build_followup_context(
                        previous_notes
                    )

            # Adapt the conversation to the level chosen in the app.
            learner_level = lessons.level(language)
            if learner_level:
                final_prompt += (
                    "\n\n[Learner level]\n" + curriculum.LEVEL_GUIDANCE[learner_level]
                )

            transcriber = stt.Transcriber(
                model=settings["whisper_model"],
                language=language,
                threads=int(settings["threads"]),
                high_quality=bool(settings["high_quality"]),
            )
            llm = tutor.EnglishTutor(
                settings["api"], settings["model"], final_prompt, final_feedback_prompt
            )
            llm.test_connection()
            logger = tutor.ConversationLogger(logs_dir, language_name)

            self._session = {
                "language": language,
                "number": progress.snapshot(language)["sessions_done"] + 1,
                "followup": bool(previous_notes),
                "previous_notes": previous_notes,
                "replies": 0,
                "goal": int(settings["goal"]),
                "turns": [],
                "feedback_done": False,
                "counted": False,
                "llm": llm,
                "logger": logger,
                "transcriber": transcriber,
                "mic": _mic_id(settings["mic"]),
            }
            return {"ok": True, "session": self._session_public()}

    def end_session(self) -> None:
        with self._lock:
            self.cancel_recording()
            session = self._session
            if session and session["replies"] > 0 and not session["counted"]:
                progress.complete_session(session["language"], with_feedback=False)
            self._session = None

    # --- Recording and conversation ----------------------------------------------

    def start_recording(self) -> None:
        with self._lock:
            session = self._require_session()
            if self._busy:
                raise RuntimeError("Attends la fin de la réponse en cours.")
            if self._recorder is not None:
                return
            recorder = audio.Recorder(
                device=session["mic"],
                on_level=lambda value: self._emit(
                    {"type": "level", "value": round(value, 3)}
                ),
            )
            recorder.start()
            self._recorder = recorder

    def cancel_recording(self) -> None:
        with self._lock:
            recorder, self._recorder = self._recorder, None
        if recorder is not None:
            recorder.cancel()

    def stop_recording(self) -> None:
        with self._lock:
            session = self._require_session()
            recorder, self._recorder = self._recorder, None
            if recorder is None:
                return
            self._busy = True
        threading.Thread(
            target=self._process_recording, args=(session, recorder), daemon=True
        ).start()

    def _process_recording(self, session, recorder) -> None:
        handle, wav_name = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        wav_path = Path(wav_name)
        try:
            duration = recorder.stop(wav_path)
            if duration < 0.4:
                self._emit({"type": "no_speech"})
                return

            self._emit({"type": "transcribing"})
            user_text = session["transcriber"].transcribe(wav_path)
            if not user_text:
                self._emit({"type": "no_speech"})
                return

            session["logger"].write_user(user_text)
            session["turns"].append({"role": "user", "text": user_text})
            session["replies"] += 1
            gained = progress.add_reply()
            self._emit(
                {
                    "type": "user_turn",
                    "text": user_text,
                    "xp_gained": gained,
                    "progress": progress.snapshot(session["language"]),
                    "session": self._public_of(session),
                }
            )

            self._emit({"type": "thinking"})
            started = time.time()
            reply = session["llm"].chat(user_text)
            seconds = round(time.time() - started, 2)
            session["logger"].write_tutor(reply)
            session["turns"].append({"role": "tutor", "text": reply})
            self._emit(
                {
                    "type": "tutor_turn",
                    "text": reply,
                    "seconds": seconds,
                    "session": self._public_of(session),
                }
            )
        except Exception as error:  # noqa: BLE001 - keep the session alive, as the CLI does
            self._emit({"type": "error", "message": str(error)})
        finally:
            self._busy = False
            try:
                wav_path.unlink()
            except OSError:
                pass

    # --- Feedback -----------------------------------------------------------------

    def request_feedback(self) -> None:
        with self._lock:
            session = self._require_session()
            if self._busy:
                raise RuntimeError("Attends la fin de la réponse en cours.")
            if session["replies"] == 0:
                raise RuntimeError(
                    "Parle au moins une fois avant de demander ton bilan."
                )
            self.cancel_recording()
            self._busy = True
        threading.Thread(
            target=self._make_feedback, args=(session,), daemon=True
        ).start()

    def _make_feedback(self, session) -> None:
        try:
            self._emit({"type": "feedback_started"})
            logger = session["logger"]
            conversation = tutor.build_conversation_text(logger.conversation_path)
            response = session["llm"].feedback(
                conversation, previous_notes=session["previous_notes"]
            )
            feedback, briefing = tutor.split_feedback_and_briefing(response)
            if feedback:
                logger.write_feedback(feedback)
            if briefing:
                logger.write_briefing(briefing)

            language = session["language"]
            if not session["counted"]:
                rewards = progress.complete_session(language, with_feedback=True)
                session["counted"] = True
            else:
                snapshot = progress.snapshot(language)
                gained = (
                    0 if session["feedback_done"] else progress.add_feedback_bonus()
                )
                rewards = {
                    "xp_gained": gained,
                    "streak": snapshot["streak"],
                    "level": progress.snapshot(language)["level"],
                    "leveled_up": False,
                    "chest_opened": False,
                    "chest_count": snapshot["chest_count"],
                }
            session["feedback_done"] = True

            texts = progress.extract_challenges(feedback or "")
            if texts:
                challenges = progress.set_challenges(language, texts)
            else:
                challenges = progress.challenges(language)

            self._emit(
                {
                    "type": "feedback",
                    "markdown": feedback or "",
                    "briefing_saved": bool(briefing),
                    "challenges": challenges,
                    "rewards": rewards,
                    "progress": progress.snapshot(language),
                    "session": self._public_of(session),
                }
            )
        except Exception as error:  # noqa: BLE001 - report instead of crashing the app
            self._emit({"type": "error", "message": str(error)})
        finally:
            self._busy = False

    # --- Helpers ------------------------------------------------------------------

    def feedback_file(self) -> Path | None:
        session = self._session
        return session["logger"].feedback_path if session else None

    def _require_session(self):
        if self._session is None:
            raise RuntimeError("Aucune séance en cours.")
        return self._session

    @staticmethod
    def _public_of(session) -> dict:
        return {
            "number": session["number"],
            "followup": session["followup"],
            "replies": session["replies"],
            "goal": session["goal"],
            "turns": list(session["turns"]),
            "feedback_done": session["feedback_done"],
        }
