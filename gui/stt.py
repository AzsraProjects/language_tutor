"""Speech-to-text with the bundled whisper.cpp binary.

Same command line as `tutor.WhisperTranscriber`, with what a desktop app
needs on top: per-platform binary lookup, no console window on Windows and
UTF-8 decoding of the transcription.
"""

import os
import subprocess
from pathlib import Path

import tutor
from gui import net, paths

MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin"


def model_path(name: str) -> Path:
    return paths.models_dir() / f"ggml-{name}.bin"


def model_ready(name: str) -> bool:
    path = model_path(name)
    return path.is_file() and path.stat().st_size > 1_000_000


def download_model(name: str, on_progress=None) -> Path:
    target = model_path(name)
    net.download(MODEL_URL.format(name=name), target, on_progress)
    return target


def no_window_flags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


class Transcriber:
    def __init__(
        self, model: str, language: str, threads: int = 8, high_quality: bool = False
    ):
        self.binary = paths.whisper_binary()
        self.model = model_path(model)
        self.language = language
        self.threads = threads
        self.high_quality = high_quality

        if self.binary is None:
            raise FileNotFoundError("Moteur de transcription Whisper introuvable.")
        if not self.model.exists():
            raise FileNotFoundError(f"Modèle Whisper introuvable : {self.model.name}")

    def transcribe(self, audio_path) -> str:
        command = [
            str(self.binary),
            "--model",
            str(self.model),
            "--file",
            str(audio_path),
            "--language",
            self.language,
            "--threads",
            str(self.threads),
            "--no-timestamps",
        ]
        if self.high_quality:
            command.extend(["--best-of", "5", "--beam-size", "5"])

        env = dict(os.environ)
        if not paths.IS_WINDOWS:
            # The Linux binary ships next to its shared libraries.
            folder = str(self.binary.parent)
            env["LD_LIBRARY_PATH"] = (
                folder + os.pathsep + env.get("LD_LIBRARY_PATH", "")
            )

        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            env=env,
            cwd=str(self.binary.parent),
            creationflags=no_window_flags(),
        )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace")[-600:]
            raise RuntimeError("La transcription a échoué :\n" + detail)

        output = result.stdout.decode("utf-8", errors="replace")
        return tutor.WhisperTranscriber._extract_transcription(output)
