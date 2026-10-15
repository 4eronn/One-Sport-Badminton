#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/android/app/src/main/assets"

mkdir -p "$DEST"
mkdir -p "$DEST/vendor"

echo "Syncing web assets to $DEST..."

cp -f "$ROOT_DIR/index.html" "$DEST/"
cp -f "$ROOT_DIR/badminton-service.js" "$DEST/"
cp -f "$ROOT_DIR/minisoccer.html" "$DEST/"
cp -f "$ROOT_DIR/manifest.json" "$DEST/"
cp -f "$ROOT_DIR/sw.js" "$DEST/"
cp -f "$ROOT_DIR/onesport-home-hero.jpg" "$DEST/"

if ls "$ROOT_DIR"/logo*.png 1> /dev/null 2>&1; then
  cp -f "$ROOT_DIR"/logo*.png "$DEST/"
fi

if [ -f "$ROOT_DIR/badminton.html" ]; then
  cp -f "$ROOT_DIR/badminton.html" "$DEST/"
fi

if [ -d "$ROOT_DIR/vendor" ]; then
  cp -rf "$ROOT_DIR/vendor"/* "$DEST/vendor/" 2>/dev/null || true
fi

echo "Assets synced successfully."
