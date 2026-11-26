"""Voice of the tutor (text-to-speech) used by the lessons.

Speech is produced offline by Piper (https://github.com/rhasspy/piper), a
small neural voice engine. The engine and one voice per language are
downloaded once into the user's data folder, each checked against a pinned
SHA-256. Lessons adapt when no voice is installed (no listening exercises,
no "listen" buttons).
"""

import os
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path

from gui import net, paths

PIPER_RELEASE = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/"
ENGINES = {
    "windows": {
        "file": "piper_windows_amd64.zip",
        "sha256": "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
        "size": 22_477_236,
    },
    "linux": {
        "file": "piper_linux_x86_64.tar.gz",
        "sha256": "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992",
        "size": 26_460_462,
    },
}

VOICES_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
# One voice per language, chosen among those whose dataset licence allows any
# use (public domain, CC0 or CC BY).
VOICES = {
    "en": {
        "path": "en/en_US/ljspeech/medium/en_US-ljspeech-medium",
        "sha256": "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22",
        "config_sha256": "141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860",
        "size": 63_531_379,
    },
    "fr": {
        "path": "fr/fr_FR/siwis/medium/fr_FR-siwis-medium",
        "sha256": "b1d946fd68d0347155fa59bce0a018924abbef3c1561181db45ca463d83963ef",
        "config_sha256": "3b3efdbcdcae930c40d8255527170ec5c87bf05e510b67f53d75fd028df40f43",
        "size": 63_221_984,
    },
    "es": {
        "path": "es/es_ES/davefx/medium/es_ES-davefx-medium",
        "sha256": "d2c9224e122321aac3c33343957fff4d0f465226cb74c66b0f520ca3f8c0dd07",
        "config_sha256": "7d82d069eccca0f87963bd23c33166fe1ef6d24a6b231543931bfe692397f256",
        "size": 63_221_984,
    },
    "de": {
        "path": "de/de_DE/thorsten/medium/de_DE-thorsten-medium",
        "sha256": "fd270eb3d1ebf91d763f8a0f949b1b1bebdfefaea18c3aaf8577dd34536e064f",
        "config_sha256": "e5bb7410dcbbcc0be6f4544f6bc66612b315ab5cb3099ec44bb46d860bc7cca9",
        "size": 63_221_984,
    },
    "it": {
        "path": "it/it_IT/paola/medium/it_IT-paola-medium",
        "sha256": "f9b8658aa8c01f8280aa88488f6e7643a639b6225a81514c40440a01f6364a20",
        "config_sha256": "10e46e8534dd2d4051f1534ba6542f189f854454acea44a6d45ff464a83260fa",
        "size": 63_221_984,
    },
    "pt": {
        "path": "pt/pt_BR/faber/medium/pt_BR-faber-medium",
        "sha256": "75e913eb463db0b6ac7ddf68d3e4c9ac19ace36dc3b710a81039b448352b8ffc",
        "config_sha256": "6b6801319e5a70aa4d75c63343515f55d1cd671ecd1ac511586bc16216812261",
        "size": 63_221_984,
    },
}

# Slightly slower than natural speech, easier to follow for a learner.
LENGTH_SCALE = "1.15"


def voice_dir() -> Path:
    path = paths.data_dir() / "voice"
    path.mkdir(parents=True, exist_ok=True)
    return path


def engine_binary() -> Path:
    name = "piper.exe" if paths.IS_WINDOWS else "piper"
    return voice_dir() / "piper" / name


def model_path(language: str) -> Path:
    name = VOICES[language]["path"].rsplit("/", 1)[1]
    return voice_dir() / "voices" / f"{name}.onnx"


def engine_ready() -> bool:
    return engine_binary().is_file()


def voice_ready(language: str) -> bool:
    if language not in VOICES:
        return False
    model = model_path(language)
    return model.is_file() and Path(str(model) + ".json").is_file()


def supported(language: str) -> bool:
    return language in VOICES


def available(language: str) -> bool:
    """True when `synthesize` can produce speech for this language."""
    return engine_ready() and voice_ready(language)


def download_size(language: str) -> int:
    """Bytes still to download before `language` can be spoken."""
    total = 0
    if not engine_ready():
        total += ENGINES["windows" if paths.IS_WINDOWS else "linux"]["size"]
    if supported(language) and not voice_ready(language):
        total += VOICES[language]["size"]
    return total


def _fetch_verified(url: str, target: Path, expected: str, on_bytes=None) -> None:
    """Download `url` to `target`, keeping it only if its SHA-256 matches."""
    staged = target.with_name(target.name + ".unverified")
    net.download(url, staged, on_bytes)
    actual = net.sha256(staged)
    if actual != expected:
        staged.unlink(missing_ok=True)
        raise RuntimeError(
            f"Téléchargement de la voix refusé : empreinte inattendue ({target.name})."
        )
    staged.replace(target)


def _extract_zip(archive: Path, folder: Path) -> None:
    root = folder.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.namelist():
            if not (root / member).resolve().is_relative_to(root):
                raise RuntimeError("Archive de la voix invalide.")
        bundle.extractall(root)


def _install_engine(on_bytes=None) -> None:
    engine = ENGINES["windows" if paths.IS_WINDOWS else "linux"]
    with tempfile.TemporaryDirectory(dir=voice_dir()) as work_name:
        work = Path(work_name)
        archive = work / engine["file"]
        _fetch_verified(
            PIPER_RELEASE + engine["file"], archive, engine["sha256"], on_bytes
        )
        unpacked = work / "unpacked"
        unpacked.mkdir()
        if archive.suffix == ".zip":
            _extract_zip(archive, unpacked)
        else:
            with tarfile.open(archive) as bundle:
                bundle.extractall(unpacked, filter="data")
        final = voice_dir() / "piper"
        if final.exists():
            shutil.rmtree(final)
        (unpacked / "piper").replace(final)
    if not engine_ready():
        raise RuntimeError("Le moteur de voix n'a pas pu être installé.")


def install(language: str, on_progress=None) -> None:
    """Download what is missing to speak `language`; `on_progress(percent)`."""
    if not supported(language):
        raise RuntimeError("Pas de voix disponible pour cette langue.")
    total = download_size(language) or 1
    done_before = 0

    def report(done, _total):
        if on_progress:
            on_progress(min(99, int((done_before + done) * 100 / total)))

    if not engine_ready():
        _install_engine(report)
        done_before += ENGINES["windows" if paths.IS_WINDOWS else "linux"]["size"]
    if not voice_ready(language):
        voice = VOICES[language]
        model = model_path(language)
        model.parent.mkdir(parents=True, exist_ok=True)
        url = VOICES_URL + voice["path"] + ".onnx"
        _fetch_verified(
            url + ".json", Path(str(model) + ".json"), voice["config_sha256"]
        )
        _fetch_verified(url, model, voice["sha256"], report)
    synthesize.cache_clear()


@lru_cache(maxsize=64)
def synthesize(text: str, language: str) -> bytes:
    """Return WAV audio of `text` spoken in `language`."""
    if not available(language):
        raise RuntimeError("La voix du tuteur n'est pas encore installée.")
    binary = engine_binary()
    env = dict(os.environ)
    if not paths.IS_WINDOWS:
        # The Linux binary ships next to its shared libraries.
        env["LD_LIBRARY_PATH"] = (
            str(binary.parent) + os.pathsep + env.get("LD_LIBRARY_PATH", "")
        )
    handle, wav_name = tempfile.mkstemp(suffix=".wav")
    os.close(handle)
    wav = Path(wav_name)
    try:
        result = subprocess.run(
            [
                str(binary),
                "--model",
                str(model_path(language)),
                "--output_file",
                str(wav),
                "--length_scale",
                LENGTH_SCALE,
            ],
            input=" ".join(text.split()).encode("utf-8"),
            capture_output=True,
            check=False,
            env=env,
            cwd=str(binary.parent),
            timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0 or wav.stat().st_size < 100:
            detail = result.stderr.decode("utf-8", errors="replace")[-400:]
            raise RuntimeError("La voix du tuteur a échoué :\n" + detail)
        return wav.read_bytes()
    finally:
        wav.unlink(missing_ok=True)
