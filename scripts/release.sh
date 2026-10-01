#!/bin/bash
# Publish a new version of Deiza for desktop. Every installed copy (1.1.1+) sees the blue
# "Actualizar" button within a few hours and updates itself in one click.
#
#   1. Bump "version" in package.json (it must be higher than the published one).
#   2. npm run release -- "Notas de la versión en español"
#
# Builds macOS (arm64 + x64), Windows and Linux, writes release/latest.json with sizes and
# sha256, uploads everything to deiza.org/downloads/desktop and checks the hashes there.
set -euo pipefail
cd "$(dirname "$0")/.."

NOTES="${1:-}"
# Where releases go: set DEIZA_SSH (ssh host or alias, key auth) and DEIZA_RELEASE_DIR (folder served
# as https://deiza.org/downloads/desktop/), in the environment or in an untracked .release.env file.
[ -f .release.env ] && . ./.release.env
SSH_HOST="${DEIZA_SSH:?Define DEIZA_SSH (host del servidor de descargas)}"
REMOTE_DIR="${DEIZA_RELEASE_DIR:?Define DEIZA_RELEASE_DIR (carpeta de descargas en el servidor)}"
VERSION="$(node -p "require('./package.json').version")"
[ -n "$NOTES" ] || { echo "Uso: npm run release -- \"Notas de la versión\""; exit 1; }

PUBLISHED="$(curl -fsSL "https://deiza.org/downloads/desktop/latest.json?t=$(date +%s)" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")"
node -e "
const [a,b]=process.argv.slice(1).map(v=>v.split('.').map(Number));
for(let i=0;i<3;i++){if(a[i]>b[i])process.exit(0);if(a[i]<b[i])break;}
console.error('La versión $VERSION no es mayor que la publicada ($PUBLISHED): sube \"version\" en package.json.');process.exit(1);
" "$VERSION" "$PUBLISHED"

# Signing. Without credentials the builds are ad hoc (macOS Gatekeeper and Windows SmartScreen
# warn on the first install from a browser download; in-app updates never warn).
#   macOS  Developer ID + notarization: set APPLE_TEAM_ID plus either APPLE_API_KEY /
#          APPLE_API_KEY_ID / APPLE_API_ISSUER or APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD, and
#          have the "Developer ID Application" certificate in the keychain (or CSC_LINK/CSC_KEY_PASSWORD).
#   Windows code signing certificate (.pfx): WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD.
MAC_SIGN=()
echo '{ "stableSignature": false }' > src/main/build-info.json
if [ -n "${APPLE_TEAM_ID:-}" ]; then
  echo "macOS: firma Developer ID + notarización"
  # A stable signature lets the app keep its keys in the macOS keychain without repeated prompts.
  echo '{ "stableSignature": true }' > src/main/build-info.json
  MAC_SIGN=(-c.mac.identity=null -c.mac.hardenedRuntime=true -c.mac.gatekeeperAssess=false
            -c.mac.entitlements=build/entitlements.mac.plist -c.mac.entitlementsInherit=build/entitlements.mac.plist
            -c.mac.notarize=true)
else
  echo "macOS: sin credenciales de Apple, firma ad hoc (Gatekeeper avisará en la primera instalación desde el navegador)"
fi
WIN_SIGN=()
if [ -n "${WIN_CSC_LINK:-}" ]; then
  echo "Windows: firma con certificado"
  WIN_SIGN=(-c.win.signAndEditExecutable=true)
else
  echo "Windows: sin certificado (SmartScreen avisará en la primera instalación desde el navegador)"
fi

echo "Compilando Deiza ${VERSION}…"
npx electron-builder --mac --arm64 --x64 --publish never ${MAC_SIGN[@]+"${MAC_SIGN[@]}"}
npx electron-builder --win --publish never ${WIN_SIGN[@]+"${WIN_SIGN[@]}"}
npx electron-builder --linux --publish never

echo '{ "stableSignature": false }' > src/main/build-info.json
FILES="$(python3 scripts/make-latest.py release "$VERSION" "$NOTES")"
echo "Subiendo: $FILES"
# The upload is slow and long; a dropped connection resumes where it stopped (up to 6 tries).
upload() {
  for try in 1 2 3 4 5 6; do
    if rsync -a --partial --timeout=120 -e "ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=6" "$@"; then return 0; fi
    echo "Subida interrumpida (intento $try). Reanudando en 10 s…"
    sleep 10
  done
  return 1
}
(cd release && upload $FILES "$SSH_HOST:$REMOTE_DIR/")
# latest.json goes last: clients only see the new version once every file is in place.
upload release/latest.json "$SSH_HOST:$REMOTE_DIR/latest.json"

ssh "$SSH_HOST" "cd $REMOTE_DIR && python3 -c \"
import json,hashlib
j=json.load(open('latest.json'))
bad=[f for f,h in j['sha256'].items() if hashlib.sha256(open(f,'rb').read()).hexdigest()!=h]
print('Hashes en el servidor:', 'OK' if not bad else 'NO COINCIDEN: '+', '.join(bad))
raise SystemExit(1 if bad else 0)\""
echo "Publicada Deiza $VERSION. Las apps instaladas mostrarán el botón Actualizar."
