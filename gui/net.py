"""Small HTTP helpers built on the standard library (no extra dependency)."""

import hashlib
import json
import ssl
import urllib.request
from pathlib import Path

USER_AGENT = "language-tutor-desktop"


def _context():
    try:
        import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:  # noqa: BLE001 - fall back to the default trust store
        return ssl.create_default_context()


def _open(url: str, data: bytes | None = None, timeout: float = 30):
    headers = {"User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)
    if url.startswith("https://"):
        return urllib.request.urlopen(request, timeout=timeout, context=_context())
    return urllib.request.urlopen(request, timeout=timeout)


def get_json(url: str, timeout: float = 15):
    with _open(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json_stream(url: str, payload: dict, timeout: float = 60):
    """POST JSON and yield each JSON line of the streamed response."""
    with _open(
        url, data=json.dumps(payload).encode("utf-8"), timeout=timeout
    ) as response:
        for line in response:
            line = line.strip()
            if line:
                yield json.loads(line.decode("utf-8"))


def download(url: str, target: Path, on_progress=None, timeout: float = 60) -> None:
    """Download to `target` atomically; `on_progress(done_bytes, total_or_None)`."""
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    with _open(url, timeout=timeout) as response, partial.open("wb") as out:
        total = int(response.headers.get("Content-Length") or 0) or None
        done = 0
        last_reported = -1
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if on_progress:
                step = int(done * 100 / total) if total else done // (4 * 1024 * 1024)
                if step != last_reported:
                    last_reported = step
                    on_progress(done, total)
    if total and done != total:
        partial.unlink(missing_ok=True)
        raise OSError("Téléchargement incomplet.")
    partial.replace(target)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
