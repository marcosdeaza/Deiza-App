import json, hashlib, os, sys, datetime
R, V, notes = sys.argv[1], sys.argv[2], sys.argv[3]
f = lambda n: f"Deiza-{V}-{n}"
files = {"mac-arm64": f("mac-arm64.dmg"), "mac-x64": f("mac-x64.dmg"), "win-x64": f("win-x64.exe"),
         "linux-x64": f("linux-x86_64.AppImage"), "linux-arm64": f("linux-arm64.AppImage"),
         "linux-deb": f("linux-amd64.deb"), "linux-deb-arm64": f("linux-arm64.deb")}
zips = {"mac-arm64": f("mac-arm64.zip"), "mac-x64": f("mac-x64.zip")}
allf = list(files.values()) + list(zips.values())
missing = [x for x in allf if not os.path.exists(os.path.join(R, x))]
if missing: sys.exit(f"missing {missing}")
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
    return h.hexdigest()
out = {"version": V, "date": datetime.date.today().isoformat(), "notes": notes, "files": files, "zip": zips,
       "zip_mac_arm64": zips["mac-arm64"], "zip_mac_x64": zips["mac-x64"],
       "sizes": {k: os.path.getsize(os.path.join(R, v)) for k, v in files.items()},
       "bytes": {x: os.path.getsize(os.path.join(R, x)) for x in allf},
       "sha256": {x: sha(os.path.join(R, x)) for x in allf}}
json.dump(out, open(os.path.join(R, 'latest.json'), 'w'), indent=2, ensure_ascii=False)
print(' '.join(allf))
