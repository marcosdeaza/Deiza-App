/**
 * electron-builder afterPack hook.
 * Windows: the executable's icon and version strings are written with resedit (pure JS), so the
 * Windows installer can be produced on macOS without Wine/rcedit.
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit');
  const productFilename = context.packager.appInfo.productFilename;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map(i => i.data));

  const [vi] = Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const nums = version.split('.').map(n => parseInt(n, 10) || 0);
    vi.setFileVersion(nums[0] || 0, nums[1] || 0, nums[2] || 0, 0, 1033);
    vi.setProductVersion(nums[0] || 0, nums[1] || 0, nums[2] || 0, 0, 1033);
    const langs = vi.getAllLanguagesForStringValues();
    const target = langs.length ? langs : [{ lang: 1033, codepage: 1200 }];
    for (const l of target) {
      vi.setStringValues(l, {
        ProductName: 'Deiza',
        FileDescription: 'Deiza',
        CompanyName: 'Deiza Solutions',
        LegalCopyright: 'Copyright © 2026 Deiza Solutions',
        OriginalFilename: `${productFilename}.exe`,
        InternalName: productFilename,
        FileVersion: version,
        ProductVersion: version,
      });
    }
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • patched ${path.basename(exePath)}: icon group ${groupId}, version ${version}`);
};
