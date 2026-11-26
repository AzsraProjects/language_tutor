"""User settings of the desktop app, stored as JSON in the data folder."""

import json
import threading
from pathlib import Path

from gui import paths

DEFAULTS = {
    "language": "en",
    "api": "ollama",
    "base_url": "http://127.0.0.1:11434/v1",
    "api_key": "",
    "model": "llama3.2:3b",
    "whisper_model": "base",
    "high_quality": False,
    "mic": None,
    "goal": 5,
    "threads": 8,
}

WHISPER_MODELS = ["tiny", "base", "small", "medium"]
OLLAMA_URL = "http://127.0.0.1:11434"

_lock = threading.Lock()


def _file() -> Path:
    return paths.data_dir() / "settings.json"


def load() -> dict:
    settings = dict(DEFAULTS)
    try:
        stored = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stored = {}
    if isinstance(stored, dict):
        settings.update({key: stored[key] for key in DEFAULTS if key in stored})
    return settings


def save(settings: dict) -> None:
    clean = {key: settings.get(key, DEFAULTS[key]) for key in DEFAULTS}
    with _lock:
        tmp = _file().with_suffix(".tmp")
        tmp.write_text(
            json.dumps(clean, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp.replace(_file())


def update(changes: dict) -> dict:
    """Apply the allowed keys of `changes` and return the new settings."""
    settings = load()
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        if key == "goal":
            value = max(1, min(50, int(value)))
        if key == "whisper_model" and value not in WHISPER_MODELS:
            continue
        if key == "api" and value not in ("ollama", "mistral", "openai", "opencode"):
            continue
        if key == "api_key" and value is None:
            continue
        settings[key] = value
    if settings["api"] == "ollama" and not settings["base_url"]:
        settings["base_url"] = DEFAULTS["base_url"]
    save(settings)
    return settings


def public(settings: dict) -> dict:
    """Settings as sent to the interface: the API key never leaves the backend."""
    shown = {key: value for key, value in settings.items() if key != "api_key"}
    shown["api_key_set"] = bool(settings.get("api_key"))
    return shown
