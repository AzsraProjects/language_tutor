# PyInstaller spec of the Language Tutor desktop app (Windows and Linux).
#   pyinstaller --noconfirm packaging/language_tutor.spec
import ctypes.util
import sys
from pathlib import Path

ROOT = Path(SPECPATH).resolve().parent
IS_WINDOWS = sys.platform == "win32"

datas = [
    (str(ROOT / "gui" / "web"), "gui/web"),
    (str(ROOT / "tutor_system_prompt.txt"), "."),
    (str(ROOT / "feedback_system_prompt.txt"), "."),
    (str(ROOT / "build" / "whisper"), "whisper"),
    (str(ROOT / "packaging" / "icon.png"), "."),
]

binaries = []
if not IS_WINDOWS:
    # sounddevice needs PortAudio, which Linux wheels do not ship.
    name = ctypes.util.find_library("portaudio")
    if name:
        for folder in ("/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"):
            candidate = Path(folder) / name
            if candidate.exists():
                binaries.append((str(candidate), "."))
                break

a = Analysis(
    [str(ROOT / "gui" / "app.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=["tutor"],
    excludes=["tkinter", "pytest", "ruff", "PIL"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LanguageTutor",
    console=False,
    icon=str(ROOT / "packaging" / "icon.ico") if IS_WINDOWS else None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="LanguageTutor")
