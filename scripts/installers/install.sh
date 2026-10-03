#!/bin/bash
# Deiza para escritorio — instalador para macOS, Linux y Chromebook.
#   curl -fsSL https://deiza.org/downloads/desktop/install.sh | bash
# Descarga la última versión para tu equipo, comprueba que es idéntica a la publicada, la instala
# y la abre. Si algo falla, tu versión anterior se queda como estaba.
#   macOS      la deja en Aplicaciones (Apple Silicon o Intel)
#   Linux      instala el paquete .deb con apt (Debian, Ubuntu y el Linux de los Chromebook); en
#              otras distribuciones deja el AppImage en ~/.local/bin con su entrada en el menú
set -euo pipefail

BASE="https://deiza.org/downloads/desktop"

MANIFEST="$(curl -fsSL "$BASE/latest.json?t=$(date +%s)" | tr -d '\n')"
VERSION="$(printf '%s' "$MANIFEST" | grep -o '"version": *"[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
# File name published under a key of latest.json ("zip_mac_arm64", "linux-deb", …).
file_for() { printf '%s' "$MANIFEST" | grep -o "\"$1\": *\"[^\"]*\"" | head -n1 | cut -d'"' -f4 || true; }
sha_for() { printf '%s' "$MANIFEST" | grep -o '"sha256": *{[^}]*}' | grep -o "\"$1\": *\"[0-9a-f]\{64\}\"" | cut -d'"' -f4 || true; }
[ -n "$VERSION" ] || { echo "No se pudo leer la versión publicada." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# download KEY DEST: fetches the file published under KEY and checks its sha256.
download() {
  FILE="$(file_for "$1")"
  [ -n "$FILE" ] || { echo "No hay una versión publicada para tu equipo ($1)." >&2; exit 1; }
  local sha; sha="$(sha_for "$FILE")"
  echo "Descargando Deiza $VERSION…"
  curl -fL --progress-bar "$BASE/$FILE" -o "$2"
  if [ -n "$sha" ]; then
    local got
    if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$2" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$2" | cut -d' ' -f1)"; fi
    if [ "$got" != "$sha" ]; then
      echo "La descarga no coincide con la publicada. No se ha instalado nada; inténtalo de nuevo." >&2
      exit 1
    fi
  fi
}

install_mac() {
  local key="zip_mac_x64"
  # Rosetta reports x86_64; prefer the native build on Apple Silicon.
  if [ "$(uname -m)" = "arm64" ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then key="zip_mac_arm64"; fi
  download "$key" "$TMP/Deiza.zip"
  mkdir -p "$TMP/app"
  ditto -x -k "$TMP/Deiza.zip" "$TMP/app"
  [ -d "$TMP/app/Deiza.app" ] || { echo "El paquete descargado no contiene la app." >&2; exit 1; }
  xattr -dr com.apple.quarantine "$TMP/app/Deiza.app" 2>/dev/null || true

  local dest="/Applications"
  [ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
  if pgrep -x Deiza >/dev/null 2>&1; then
    osascript -e 'tell application id "org.deiza.desktop" to quit' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Deiza >/dev/null 2>&1 || break; sleep 1; done
  fi
  if [ -d "$dest/Deiza.app" ]; then mv "$dest/Deiza.app" "$TMP/Deiza.previous.app"; fi
  if ! ditto "$TMP/app/Deiza.app" "$dest/Deiza.app"; then
    rm -rf "$dest/Deiza.app"
    [ -d "$TMP/Deiza.previous.app" ] && mv "$TMP/Deiza.previous.app" "$dest/Deiza.app"
    echo "No se pudo copiar la app a $dest. Tu versión anterior sigue instalada." >&2
    exit 1
  fi
  echo "Deiza $VERSION instalada en $dest."
  open "$dest/Deiza.app"
}

# Closes a running copy so the files can be replaced; it reopens at the end.
quit_linux_app() {
  if pgrep -f "$1" >/dev/null 2>&1; then
    echo "Cerrando Deiza para actualizarla…"
    pkill -TERM -f "$1" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$1" >/dev/null 2>&1 || break; sleep 1; done
  fi
}

open_linux_app() {
  [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || return 0
  if command -v setsid >/dev/null 2>&1; then
    setsid -f "$@" >/dev/null 2>&1 </dev/null || true
  else
    nohup "$@" >/dev/null 2>&1 </dev/null &
  fi
}

install_linux() {
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Deiza para escritorio necesita un equipo de 64 bits (Intel, AMD o ARM). El tuyo es $(uname -m)." >&2; exit 1 ;;
  esac
  local chromebook=0
  if [ -e /dev/.cros_milestone ] || [ -d /opt/google/cros-containers ]; then chromebook=1; fi

  if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
    local sudo=""
    if [ "$(id -u)" -ne 0 ]; then
      command -v sudo >/dev/null 2>&1 || { echo "Hace falta sudo para instalar el paquete." >&2; exit 1; }
      sudo="sudo"
    fi
    local key="linux-deb"; [ "$arch" = "arm64" ] && key="linux-deb-arm64"
    # apt reads the package as its own unprivileged user: keep the folder readable.
    chmod 755 "$TMP"
    download "$key" "$TMP/deiza.deb"
    chmod 644 "$TMP/deiza.deb"
    # Ask for the password (if any) up front, before apt's output goes to the log.
    if [ -n "$sudo" ]; then sudo -v || { echo "Hace falta tu contraseña para instalar el paquete." >&2; exit 1; }; fi
    quit_linux_app /opt/Deiza/deiza-desktop
    echo "Instalando… La primera vez tarda unos minutos."
    local log="$TMP/apt.log"
    # A fresh container may not have the package lists yet: refresh them and retry once.
    if ! $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$TMP/deiza.deb" >"$log" 2>&1; then
      $sudo apt-get update -q >>"$log" 2>&1 || true
      if ! $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$TMP/deiza.deb" >>"$log" 2>&1; then
        tail -n 20 "$log" >&2
        echo "No se pudo instalar el paquete. Si ya tenías Deiza, sigue instalada como estaba." >&2
        exit 1
      fi
    fi
    echo
    echo "Deiza $VERSION instalada."
    if [ "$chromebook" = 1 ]; then
      echo "La tienes en el menú de aplicaciones, dentro de la carpeta «Apps de Linux»."
      echo "Para que Deiza Code trabaje en una carpeta de Archivos, pulsa con el botón derecho sobre ella > Compartir con Linux."
    fi
    open_linux_app /opt/Deiza/deiza-desktop
    return
  fi

  # Other distributions: the AppImage, updated in place by the app itself.
  local key="linux-$arch"
  local bin="$HOME/.local/bin" apps="$HOME/.local/share/applications" icons="$HOME/.local/share/icons/hicolor/512x512/apps"
  mkdir -p "$bin" "$apps" "$icons"
  download "$key" "$TMP/Deiza.AppImage"
  chmod +x "$TMP/Deiza.AppImage"
  quit_linux_app "$bin/Deiza.AppImage"
  mv -f "$TMP/Deiza.AppImage" "$bin/Deiza.AppImage"
  curl -fsSL "https://deiza.org/app-icon-512.png" -o "$icons/deiza-desktop.png" 2>/dev/null || true
  # AppImages mount themselves with FUSE 2; without it they can still run by unpacking first.
  local env_prefix=""
  if ! { ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null || true; } | grep -q 'libfuse\.so\.2'; then env_prefix="env APPIMAGE_EXTRACT_AND_RUN=1 "; fi
  cat > "$apps/deiza-desktop.desktop" <<EOF
[Desktop Entry]
Name=Deiza
Exec=${env_prefix}$bin/Deiza.AppImage %U
Terminal=false
Type=Application
Icon=deiza-desktop
StartupWMClass=deiza-desktop
Comment=El workspace de Deiza y Deiza Code en una sola app.
MimeType=x-scheme-handler/deiza;
Categories=Office;
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps" >/dev/null 2>&1 || true
  echo
  echo "Deiza $VERSION instalada en $bin/Deiza.AppImage y en el menú de aplicaciones."
  if [ -n "$env_prefix" ]; then
    open_linux_app env APPIMAGE_EXTRACT_AND_RUN=1 "$bin/Deiza.AppImage"
  else
    open_linux_app "$bin/Deiza.AppImage"
  fi
}

case "$(uname -s)" in
  Darwin) install_mac ;;
  Linux) install_linux ;;
  *) echo "Este instalador es para macOS y Linux. En Windows: irm https://deiza.org/downloads/desktop/install.ps1 | iex" >&2; exit 1 ;;
esac
