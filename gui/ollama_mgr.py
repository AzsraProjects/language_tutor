"""Detect, start and feed the local Ollama server used by default."""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from gui import net, paths
from gui.config import OLLAMA_URL
from gui.stt import no_window_flags

WINDOWS_INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe"
LINUX_INSTALL_COMMAND = "curl -fsSL https://ollama.com/install.sh | sh"


def executable() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    if paths.IS_WINDOWS:
        local = os.getenv("LOCALAPPDATA")
        if local:
            candidate = Path(local) / "Programs" / "Ollama" / "ollama.exe"
            if candidate.is_file():
                return str(candidate)
    else:
        for candidate in ("/usr/local/bin/ollama", "/usr/bin/ollama"):
            if Path(candidate).is_file():
                return candidate
    return None


def running() -> bool:
    try:
        net.get_json(OLLAMA_URL + "/api/version", timeout=2)
    except Exception:  # noqa: BLE001 - any failure means "not reachable"
        return False
    return True


def models() -> list[str]:
    try:
        data = net.get_json(OLLAMA_URL + "/api/tags", timeout=5)
    except Exception:  # noqa: BLE001 - server not reachable
        return []
    return sorted(item["name"] for item in data.get("models", []))


def has_model(name: str) -> bool:
    installed = models()
    if name in installed:
        return True
    # "llama3.2" and "llama3.2:latest" name the same model.
    return ":" not in name and f"{name}:latest" in installed


def start(wait_seconds: float = 20) -> bool:
    if running():
        return True
    exe = executable()
    if exe is None:
        return False
    kwargs = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
    }
    if paths.IS_WINDOWS:
        kwargs["creationflags"] = no_window_flags() | getattr(
            subprocess, "DETACHED_PROCESS", 0
        )
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([exe, "serve"], **kwargs)
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        if running():
            return True
        time.sleep(0.5)
    return False


def pull(name: str, on_progress=None) -> None:
    """Download a model through the Ollama API, reporting progress."""
    stream = net.post_json_stream(
        OLLAMA_URL + "/api/pull", {"model": name}, timeout=600
    )
    for event in stream:
        if event.get("error"):
            raise RuntimeError(event["error"])
        if on_progress:
            total = event.get("total")
            done = event.get("completed")
            pct = int(done * 100 / total) if total and done is not None else None
            on_progress(pct, event.get("status", ""))


def install(on_progress=None) -> None:
    """Install Ollama: official installer on Windows, official script on Linux."""
    if paths.IS_WINDOWS:
        installer = Path(tempfile.gettempdir()) / "OllamaSetup.exe"

        def report(done, total):
            if on_progress:
                pct = int(done * 100 / total) if total else None
                on_progress(pct, "Téléchargement d'Ollama…")

        net.download(WINDOWS_INSTALLER_URL, installer, report)
        if on_progress:
            on_progress(None, "Installation d'Ollama…")
        result = subprocess.run(
            [str(installer), "/VERYSILENT", "/NORESTART"], check=False
        )
        if result.returncode != 0:
            raise RuntimeError("L'installation d'Ollama a été annulée ou a échoué.")
        return

    pkexec = shutil.which("pkexec")
    if pkexec is None:
        raise RuntimeError(
            "Installe Ollama depuis un terminal avec :\n" + LINUX_INSTALL_COMMAND
        )
    if on_progress:
        on_progress(None, "Installation d'Ollama (mot de passe demandé)…")
    result = subprocess.run([pkexec, "sh", "-c", LINUX_INSTALL_COMMAND], check=False)
    if result.returncode != 0:
        raise RuntimeError(
            "L'installation n'a pas abouti. Tu peux la lancer depuis un terminal :\n"
            + LINUX_INSTALL_COMMAND
        )
