#!/usr/bin/env bash
# Packs the Linux release bundle (`flutter build linux --release`) into an AppImage (#108, step 3.2).
# Usage, from app/: packaging/linux/build-appimage.sh <path to appimagetool> <output file>
# GTK, libsecret and the rest come from the system, as for any Flutter Linux app.
set -euo pipefail

TOOL="$(realpath "$1")"
OUT="$(realpath -m "$2")"
cd "$(dirname "$0")/../.."

BUNDLE=build/linux/x64/release/bundle
APPDIR=build/AppDir
ID=com.owaisahmed.tsuzuku

[ -x "$BUNDLE/tsuzuku" ] || { echo "No release bundle in $BUNDLE: run flutter build linux --release first" >&2; exit 1; }

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
# The Flutter bundle as is: tsuzuku, lib/, data/ (the binary finds lib/ and data/ next to itself).
cp -r "$BUNDLE/." "$APPDIR/usr/bin/"
# X-AppImage-Version: the version AppImage managers (Shelly) show; from pubspec.yaml, which CI checks against the tag.
VERSION=$(sed -n 's/^version: *\([^+ ]*\).*/\1/p' pubspec.yaml)
{ cat packaging/linux/tsuzuku.desktop; echo "X-AppImage-Version=$VERSION"; } > "$APPDIR/$ID.desktop"
cp assets/icon/icon-512.png "$APPDIR/$ID.png"
ln -s "$ID.png" "$APPDIR/.DirIcon"
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/tsuzuku" "$@"
EOF
chmod +x "$APPDIR/AppRun"

# Extract-and-run: appimagetool is itself an AppImage, and CI runners have no FUSE.
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$TOOL" --no-appstream "$APPDIR" "$OUT"
