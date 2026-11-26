#!/bin/sh
# Build the Linux app archive: dist/language-tutor-linux-x64-<version>.tar.gz
# Needs: Python 3.12 with requirements-gui.txt + pyinstaller, and libportaudio2.
#   sh packaging/build_linux.sh [python]
set -e
PYTHON="${1:-python3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$("$PYTHON" -c 'from gui.version import VERSION; print(VERSION)')"
"$PYTHON" packaging/fetch_whisper.py linux
"$PYTHON" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller packaging/language_tutor.spec

STAGE="dist/language-tutor"
rm -rf "$STAGE"
mkdir -p "$STAGE"
mv dist/LanguageTutor "$STAGE/app"
cp packaging/linux/install.sh packaging/icon.png "$STAGE/"
chmod +x "$STAGE/install.sh" "$STAGE/app/LanguageTutor"
find "$STAGE/app" -path '*/whisper/*' -type f -exec chmod +x {} +

ARCHIVE="dist/language-tutor-linux-x64-$VERSION.tar.gz"
tar -czf "$ARCHIVE" -C dist language-tutor
echo "Built $ARCHIVE"
