#!/usr/bin/env node
/**
 * Microsoft Store package (MSIX/AppX). Microsoft signs Store packages, so Store installs never show
 * SmartScreen and updates come from the Store. Must run on Windows 10/11 (needs the Windows SDK's
 * makeappx, which electron-builder downloads).
 *
 *   set DEIZA_STORE_IDENTITY=12345Deiza.Deiza          (Partner Center > Product identity > Package/Identity/Name)
 *   set DEIZA_STORE_PUBLISHER=CN=XXXXXXXX-XXXX-...     (Package/Identity/Publisher)
 *   set DEIZA_STORE_PUBLISHER_NAME=Marcos de Aza       (Package/Properties/PublisherDisplayName)
 *   npm run dist:store
 *
 * Upload the resulting release/*.appx in Partner Center.
 */
const { spawnSync } = require('child_process');

const need = ['DEIZA_STORE_IDENTITY', 'DEIZA_STORE_PUBLISHER', 'DEIZA_STORE_PUBLISHER_NAME'];
const missing = need.filter(k => !process.env[k]);
if (process.platform !== 'win32') {
  console.error('El paquete de la Microsoft Store se genera en Windows 10/11.');
  process.exit(1);
}
if (missing.length) {
  console.error(`Faltan: ${missing.join(', ')}. Cópialos de Partner Center > tu app > Identidad del producto.`);
  process.exit(1);
}
const args = [
  'electron-builder', '--win', 'appx', '--x64', '--publish', 'never',
  `-c.appx.identityName=${process.env.DEIZA_STORE_IDENTITY}`,
  `-c.appx.publisher=${process.env.DEIZA_STORE_PUBLISHER}`,
  `-c.appx.publisherDisplayName=${process.env.DEIZA_STORE_PUBLISHER_NAME}`,
  '-c.appx.applicationId=Deiza',
  '-c.appx.displayName=Deiza',
  '-c.appx.backgroundColor=#1c1917',
  '-c.appx.languages=es-ES',
  '-c.appx.languages=en-US',
];
const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
process.exit(r.status || 0);
