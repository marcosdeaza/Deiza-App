#!/bin/bash
# Deiza para escritorio — instalador para macOS.
#   curl -fsSL https://deiza.org/downloads/desktop/install.sh | bash
# Descarga la última versión para tu Mac (Apple Silicon o Intel), comprueba que es idéntica a la
# publicada, la deja en Aplicaciones y la abre. Si algo falla, tu versión anterior se queda como estaba.
set -euo pipefail

BASE="https://deiza.org/downloads/desktop"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este instalador es para macOS. En Windows: irm https://deiza.org/downloads/desktop/install.ps1 | iex" >&2
  exit 1
fi
KEY="zip_mac_x64"
# Rosetta reports x86_64; prefer the native build on Apple Silicon.
if [ "$(uname -m)" = "arm64" ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then KEY="zip_mac_arm64"; fi

MANIFEST="$(curl -fsSL "$BASE/latest.json?t=$(date +%s)" | tr -d '\n')"
FILE="$(printf '%s' "$MANIFEST" | grep -o "\"$KEY\": *\"[^\"]*\"" | head -n1 | cut -d'"' -f4)"
VERSION="$(printf '%s' "$MANIFEST" | grep -o '"version": *"[^"]*"' | head -n1 | cut -d'"' -f4)"
SHA="$(printf '%s' "$MANIFEST" | grep -o '"sha256": *{[^}]*}' | grep -o "\"$FILE\": *\"[0-9a-f]\{64\}\"" | cut -d'"' -f4 || true)"
if [ -z "$FILE" ]; then echo "No se pudo leer la versión publicada." >&2; exit 1; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Descargando Deiza $VERSION…"
curl -fL --progress-bar "$BASE/$FILE" -o "$TMP/Deiza.zip"
if [ -n "$SHA" ] && [ "$(shasum -a 256 "$TMP/Deiza.zip" | cut -d' ' -f1)" != "$SHA" ]; then
  echo "La descarga no coincide con la publicada. No se ha instalado nada; inténtalo de nuevo." >&2
  exit 1
fi
mkdir -p "$TMP/app"
ditto -x -k "$TMP/Deiza.zip" "$TMP/app"
[ -d "$TMP/app/Deiza.app" ] || { echo "El paquete descargado no contiene la app." >&2; exit 1; }
xattr -dr com.apple.quarantine "$TMP/app/Deiza.app" 2>/dev/null || true

DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
if pgrep -x Deiza >/dev/null 2>&1; then
  osascript -e 'tell application id "org.deiza.desktop" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Deiza >/dev/null 2>&1 || break; sleep 1; done
fi
if [ -d "$DEST/Deiza.app" ]; then mv "$DEST/Deiza.app" "$TMP/Deiza.previous.app"; fi
if ! ditto "$TMP/app/Deiza.app" "$DEST/Deiza.app"; then
  rm -rf "$DEST/Deiza.app"
  [ -d "$TMP/Deiza.previous.app" ] && mv "$TMP/Deiza.previous.app" "$DEST/Deiza.app"
  echo "No se pudo copiar la app a $DEST. Tu versión anterior sigue instalada." >&2
  exit 1
fi

echo "Deiza $VERSION instalada en $DEST."
open "$DEST/Deiza.app"
