"""In-app updates from the GitHub releases of the app's repository.

A release carries the Windows installer, the Linux archive and a
SHA256SUMS.txt file; a download is only installed when its hash matches.
"""

import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from gui import net, paths
from gui.version import UPDATE_REPO, VERSION

API_URL = f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest"
WINDOWS_ASSET = re.compile(r"^LanguageTutor-Setup-.*\.exe$")
LINUX_ASSET = re.compile(r"^language-tutor-linux-x64.*\.tar\.gz$")
SUMS_ASSET = "SHA256SUMS.txt"


def parse_version(text: str) -> tuple[int, ...]:
    numbers = re.findall(r"\d+", text.split("-")[0])
    return tuple(int(n) for n in numbers[:3]) or (0,)


def check() -> dict | None:
    """Return {version, notes, asset_url, sums_url, asset_name} when newer."""
    release = net.get_json(API_URL, timeout=10)
    tag = release.get("tag_name", "")
    if parse_version(tag) <= parse_version(VERSION):
        return None
    pattern = WINDOWS_ASSET if paths.IS_WINDOWS else LINUX_ASSET
    asset = next(
        (a for a in release.get("assets", []) if pattern.match(a["name"])), None
    )
    sums = next((a for a in release.get("assets", []) if a["name"] == SUMS_ASSET), None)
    if asset is None or sums is None:
        return None
    return {
        "version": tag.lstrip("v"),
        "notes": (release.get("body") or "").strip()[:2000],
        "asset_name": asset["name"],
        "asset_url": asset["browser_download_url"],
        "sums_url": sums["browser_download_url"],
    }


def _expected_hash(sums_path: Path, asset_name: str) -> str | None:
    for line in sums_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[-1].lstrip("*") == asset_name:
            return parts[0].lower()
    return None


def download(update: dict, on_progress=None) -> Path:
    """Download and verify the update; return the local file."""
    folder = Path(tempfile.mkdtemp(prefix="language-tutor-update-"))
    sums_path = folder / SUMS_ASSET
    asset_path = folder / update["asset_name"]
    net.download(update["sums_url"], sums_path)

    def report(done, total):
        if on_progress:
            on_progress(int(done * 100 / total) if total else None)

    net.download(update["asset_url"], asset_path, report)
    expected = _expected_hash(sums_path, update["asset_name"])
    if expected is None or net.sha256(asset_path) != expected:
        shutil.rmtree(folder, ignore_errors=True)
        raise RuntimeError(
            "La mise à jour téléchargée est corrompue ; rien n'a été installé."
        )
    return asset_path


def apply(asset_path: Path) -> None:
    """Start the installation; the caller must quit the app right after."""
    if not paths.IS_FROZEN:
        raise RuntimeError(
            "La mise à jour automatique n'existe que dans l'appli installée."
        )

    if paths.IS_WINDOWS:
        subprocess.Popen(
            [str(asset_path), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/UPDATE"],
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
            close_fds=True,
        )
        return

    target = paths.install_dir()
    staging = target.with_name(target.name + ".new")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with tarfile.open(asset_path) as archive:
        archive.extractall(staging, filter="data")
    # The archive holds one top-level folder with the app inside.
    inner = [p for p in staging.iterdir() if p.is_dir()]
    source = inner[0] / "app" if inner and (inner[0] / "app").is_dir() else staging

    script = staging.with_suffix(".sh")
    script.write_text(
        "#!/bin/sh\n"
        f"while kill -0 {os.getpid()} 2>/dev/null; do sleep 0.3; done\n"
        f'rm -rf "{target}.old"\n'
        f'mv "{target}" "{target}.old" && mv "{source}" "{target}" && rm -rf "{target}.old" "{staging}"\n'
        f'"{target}/LanguageTutor" >/dev/null 2>&1 &\n'
        f'rm -f "{script}"\n',
        encoding="utf-8",
    )
    script.chmod(0o755)
    subprocess.Popen(["/bin/sh", str(script)], start_new_session=True)
