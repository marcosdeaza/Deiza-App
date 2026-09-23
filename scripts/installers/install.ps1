# Deiza para escritorio — instalador para Windows.
#   irm https://deiza.org/downloads/desktop/install.ps1 | iex
# Descarga la última versión, comprueba que es idéntica a la publicada, la instala para tu usuario y la abre.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base = 'https://deiza.org/downloads/desktop'
$info = Invoke-RestMethod "$base/latest.json?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$file = $info.files.'win-x64'
if (-not $file) { throw 'No se pudo leer la versión publicada.' }
$sha = $null
if ($info.sha256) { $sha = $info.sha256.$file }

$tmp = Join-Path $env:TEMP $file
Write-Host "Descargando Deiza $($info.version)..."
Invoke-WebRequest "$base/$file" -OutFile $tmp -UseBasicParsing
if ($sha) {
  $got = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $sha.ToLower()) {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    throw 'La descarga no coincide con la publicada. No se ha instalado nada; inténtalo de nuevo.'
  }
}
Unblock-File $tmp

Get-Process -Name 'Deiza' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host 'Instalando...'
Start-Process -FilePath $tmp -ArgumentList '/S' -Wait
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Deiza\Deiza.exe'
if (Test-Path $exe) {
  Write-Host "Deiza $($info.version) instalada."
  Start-Process $exe
} else {
  Write-Host 'Instalación terminada. Abre Deiza desde el menú Inicio.'
}
