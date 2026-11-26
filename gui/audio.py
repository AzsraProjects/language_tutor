"""Cross-platform microphone capture producing the 16 kHz mono WAV whisper.cpp expects.

The command-line tutor records with `arecord` (Linux only); the desktop app
uses PortAudio through `sounddevice` so the same code runs on Windows and Linux.
"""

import array
import threading
import wave
from pathlib import Path

import sounddevice as sd

TARGET_RATE = 16000


def list_microphones() -> list[dict]:
    """Input devices of the default host API, default device first flagged."""
    try:
        devices = sd.query_devices()
        default_input = sd.default.device[0]
        default_api = (
            sd.query_hostapis(sd.default.hostapi)["name"]
            if sd.default.hostapi >= 0
            else None
        )
        hostapis = sd.query_hostapis()
    except Exception:  # noqa: BLE001 - PortAudio raises several unrelated error types
        return []

    mics = []
    for index, device in enumerate(devices):
        if device["max_input_channels"] < 1:
            continue
        api_name = hostapis[device["hostapi"]]["name"]
        if default_api and api_name != default_api:
            continue
        mics.append(
            {"id": index, "name": device["name"], "default": index == default_input}
        )
    return mics


def _resample(samples: array.array, source_rate: int) -> array.array:
    """Linear resampling to TARGET_RATE (speech only needs modest quality)."""
    if source_rate == TARGET_RATE or not samples:
        return samples
    ratio = source_rate / TARGET_RATE
    length = int(len(samples) / ratio)
    out = array.array("h", bytes(2 * length))
    last = len(samples) - 1
    for i in range(length):
        position = i * ratio
        left = int(position)
        right = left + 1 if left < last else last
        fraction = position - left
        out[i] = int(samples[left] * (1 - fraction) + samples[right] * fraction)
    return out


class Recorder:
    """Records from a microphone until stopped; reports the input level live."""

    def __init__(self, device=None, on_level=None):
        self.device = device
        self.on_level = on_level
        self._chunks: list[bytes] = []
        self._stream = None
        self._rate = TARGET_RATE
        self._lock = threading.Lock()
        self._level_skip = 0

    @property
    def active(self) -> bool:
        return self._stream is not None

    def _callback(self, indata, frames, time_info, status):
        data = bytes(indata)
        with self._lock:
            self._chunks.append(data)
        if self.on_level is None:
            return
        # Roughly 15 level updates per second are enough for a meter.
        self._level_skip += frames
        if self._level_skip < self._rate // 15:
            return
        self._level_skip = 0
        samples = array.array("h", data)
        peak = max((abs(s) for s in samples[::8]), default=0)
        self.on_level(min(1.0, (peak / 32768) ** 0.5 * 1.4))

    def start(self) -> None:
        if self._stream is not None:
            return
        self._chunks = []
        last_error = None
        rates = [TARGET_RATE]
        try:
            native = int(sd.query_devices(self.device, "input")["default_samplerate"])
            if native != TARGET_RATE:
                rates.append(native)
        except Exception as error:  # noqa: BLE001 - see list_microphones
            last_error = error

        for rate in rates:
            try:
                stream = sd.RawInputStream(
                    samplerate=rate,
                    channels=1,
                    dtype="int16",
                    device=self.device,
                    callback=self._callback,
                )
                stream.start()
            except Exception as error:  # noqa: BLE001 - try the next sample rate
                last_error = error
                continue
            self._stream = stream
            self._rate = rate
            return

        raise RuntimeError(f"Impossible d'ouvrir le micro : {last_error}")

    def _close(self) -> bytes:
        stream, self._stream = self._stream, None
        if stream is not None:
            stream.stop()
            stream.close()
        with self._lock:
            data = b"".join(self._chunks)
            self._chunks = []
        return data

    def cancel(self) -> None:
        self._close()

    def stop(self, output_path: Path) -> float:
        """Stop and write the WAV file; return the recorded duration in seconds."""
        data = self._close()
        samples = array.array("h", data[: len(data) - len(data) % 2])
        samples = _resample(samples, self._rate)
        with wave.open(str(output_path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(TARGET_RATE)
            wav.writeframes(samples.tobytes())
        return len(samples) / TARGET_RATE
