"""Download the prebuilt whisper.cpp command-line tool bundled with the app.

    python packaging/fetch_whisper.py            # for the current platform
    python packaging/fetch_whisper.py linux      # or: windows

The files land in build/whisper/, which the PyInstaller spec picks up.
"""

import io
import shutil
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE = "b5907"
BASE = f"https://github.com/ggml-org/whisper.cpp/releases/download/{RELEASE}/"
ASSETS = {"windows": "whisper-bin-x64.zip", "linux": "whisper-bin-ubuntu-x64.tar.gz"}


def fetch(platform: str) -> bytes:
    cache = ROOT / ".build_cache" / "whisper" / ASSETS[platform]
    if cache.is_file():
        return cache.read_bytes()
    with urllib.request.urlopen(BASE + ASSETS[platform], timeout=120) as response:
        data = response.read()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data


def extract_windows(data: bytes, target: Path) -> None:
    wanted = ("whisper-cli.exe", "whisper.dll")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            name = Path(info.filename).name
            if name in wanted or (name.startswith("ggml") and name.endswith(".dll")):
                (target / name).write_bytes(archive.read(info))


def extract_linux(data: bytes, target: Path) -> None:
    """Keep whisper-cli and its libraries; symlinks become real files."""
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        members = {Path(m.name).name: m for m in archive.getmembers()}

        def read(member) -> bytes:
            while member.issym():
                member = members[Path(member.linkname).name]
            return archive.extractfile(member).read()

        for name, member in members.items():
            is_lib = name.startswith(("libwhisper.so", "libggml")) and ".so" in name
            if name != "whisper-cli" and not is_lib:
                continue
            # The loader asks for the "libX.so.N" names; skip the other aliases.
            if is_lib and name.count(".") > 2 and not member.issym():
                continue
            if is_lib and name.endswith(".so") and (name + ".1") in members:
                continue
            out = target / name
            out.write_bytes(read(member))
            out.chmod(0o755)


def main() -> None:
    platform = (
        sys.argv[1]
        if len(sys.argv) > 1
        else ("windows" if sys.platform == "win32" else "linux")
    )
    target = ROOT / "build" / "whisper"
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    data = fetch(platform)
    if platform == "windows":
        extract_windows(data, target)
    else:
        extract_linux(data, target)
    print(
        f"whisper.cpp {RELEASE} ({platform}):",
        ", ".join(sorted(p.name for p in target.iterdir())),
    )


if __name__ == "__main__":
    main()
