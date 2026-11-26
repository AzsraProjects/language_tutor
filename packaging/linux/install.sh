#!/bin/sh
# Install Language Tutor for the current user (no root needed).
#   tar -xzf language-tutor-linux-x64-*.tar.gz && ./language-tutor/install.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
TARGET="$DATA/language-tutor-app"
BIN="$HOME/.local/bin"

rm -rf "$TARGET"
mkdir -p "$DATA" "$BIN" "$DATA/applications" "$DATA/icons/hicolor/256x256/apps"
cp -r "$HERE/app" "$TARGET"
cp "$HERE/icon.png" "$DATA/icons/hicolor/256x256/apps/language-tutor.png"
ln -sf "$TARGET/LanguageTutor" "$BIN/language-tutor"

cat > "$DATA/applications/language-tutor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Language Tutor
Comment=Practice speaking a language with a local AI tutor
Exec=$TARGET/LanguageTutor
Icon=language-tutor
Terminal=false
Categories=Education;Languages;
EOF

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" || true
echo "Language Tutor is installed. Start it from the applications menu or run: language-tutor"
