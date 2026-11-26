"""Tests of the desktop app's tutor voice: readiness and download checks."""

import zipfile

import pytest

from gui import net, tts


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LANGUAGE_TUTOR_DATA", str(tmp_path))


def test_available_without_installed_voice_returns_false():
    assert tts.available("en") is False


def test_download_size_without_anything_installed_counts_engine_and_voice():
    assert tts.download_size("en") > tts.VOICES["en"]["size"]


def test_supported_with_unknown_language_returns_false():
    assert tts.supported("xx") is False
    assert tts.download_size("xx") > 0  # the engine alone


def test_every_voice_has_pinned_checksums():
    for voice in tts.VOICES.values():
        assert len(voice["sha256"]) == 64
        assert len(voice["config_sha256"]) == 64


def test_synthesize_without_installed_voice_raises():
    with pytest.raises(RuntimeError):
        tts.synthesize("hello", "en")


def test_fetch_verified_with_wrong_checksum_discards_the_file(tmp_path, monkeypatch):
    def fake_download(url, target, on_progress=None):
        target.write_bytes(b"tampered")

    monkeypatch.setattr(net, "download", fake_download)
    target = tmp_path / "voice.onnx"

    with pytest.raises(RuntimeError):
        tts._fetch_verified("https://example.invalid/voice", target, "0" * 64)

    assert not target.exists()
    assert list(tmp_path.glob("voice.onnx*")) == []


def test_fetch_verified_with_matching_checksum_keeps_the_file(tmp_path, monkeypatch):
    def fake_download(url, target, on_progress=None):
        target.write_bytes(b"voice")

    monkeypatch.setattr(net, "download", fake_download)
    target = tmp_path / "voice.onnx"
    staged = tmp_path / "probe"
    staged.write_bytes(b"voice")
    expected = net.sha256(staged)

    tts._fetch_verified("https://example.invalid/voice", target, expected)

    assert target.read_bytes() == b"voice"


def test_extract_zip_with_path_outside_the_folder_raises(tmp_path):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../escaped.txt", "x")
    folder = tmp_path / "out"
    folder.mkdir()

    with pytest.raises(RuntimeError):
        tts._extract_zip(archive, folder)

    assert not (tmp_path / "escaped.txt").exists()
