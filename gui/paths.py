"""Filesystem locations used by the desktop app (bundled resources and user data)."""

import os
import sys
from pathlib import Path

IS_WINDOWS = sys.platform.startswith("win")
IS_FROZEN = getattr(sys, "frozen", False)


def resource_root() -> Path:
    """Folder holding the read-only files shipped with the app."""
    if IS_FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def install_dir() -> Path:
    """Folder holding the executable (only meaningful for a packaged app)."""
    return Path(sys.executable).resolve().parent


def data_dir() -> Path:
    """Per-user writable folder: settings, progress, models and session logs."""
    override = os.getenv("LANGUAGE_TUTOR_DATA")
    if override:
        base = Path(override)
    elif IS_WINDOWS:
        base = (
            Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
            / "LanguageTutor"
        )
    else:
        xdg = os.getenv("XDG_DATA_HOME")
        base = (
            Path(xdg) if xdg else Path.home() / ".local" / "share"
        ) / "language-tutor"
    base.mkdir(parents=True, exist_ok=True)
    return base


def web_dir() -> Path:
    return resource_root() / "gui" / "web"


def prompt_path(name: str) -> Path:
    return resource_root() / name


def logs_root() -> Path:
    path = data_dir() / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def models_dir() -> Path:
    path = data_dir() / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def whisper_bin_dirs() -> list[Path]:
    """Candidate folders for the whisper.cpp command-line binary, best first."""
    root = resource_root()
    platform_dir = "win" if IS_WINDOWS else "linux"
    return [
        root / "whisper",
        root / "build" / "whisper",
        root / ".build_cache" / "whisper" / platform_dir / "Release",
        root / ".build_cache" / "whisper" / platform_dir / "whisper-bin-ubuntu-x64",
        root / "models" / "whisper.cpp" / "build" / "bin",
    ]


def whisper_binary() -> Path | None:
    name = "whisper-cli.exe" if IS_WINDOWS else "whisper-cli"
    for folder in whisper_bin_dirs():
        candidate = folder / name
        if candidate.is_file():
            return candidate
    return None
