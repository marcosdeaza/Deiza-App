#!/bin/bash
# Copies the committed tree to a folder for the public repository, without internal documents.
#   bash scripts/export-public.sh ../Deiza-App
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:?Uso: bash scripts/export-public.sh <carpeta destino>}"
mkdir -p "$DEST"
find "$DEST" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive HEAD | tar -x -C "$DEST"
# Internal notes stay private: every Markdown file except the README, and docs/*.md.
find "$DEST" -maxdepth 1 -name "*.md" ! -name README.md -delete
find "$DEST/docs" -maxdepth 1 -name "*.md" -delete 2>/dev/null || true
cp scripts/public/AGENTS.md "$DEST/AGENTS.md"
echo "Exportado a $DEST"
