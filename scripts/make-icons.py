#!/usr/bin/env python3
"""Renders the app icons from build/rose.svg (needs Playwright + Pillow; macOS iconutil for .icns).

Burgundy tile with the cream Deiza rose, large and bold so it reads in the Dock and the
Windows taskbar. Small sizes (<= 48 px) are drawn separately with a heavier stroke.

  build/icon.png   1024 px, macOS squircle with margins (also used by Linux)
  build/icon.icns  macOS
  build/icon.ico   Windows (16-256 px)
  build/icon-win.png, src/renderer/icon.png   window icon for Windows/Linux
"""
import io, os, re, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
BUILD = os.path.join(ROOT, 'build')
D = re.search(r' d="([^"]+)"', open(os.path.join(BUILD, 'rose.svg')).read()).group(1)
BG = 'linear-gradient(180deg,#9a2a3a 0%,#6f1824 100%)'
FG = '#f7ecdc'


def page(size, inset, radius, scale, stroke, shadow):
    inner = size - 2 * inset
    off = (1 - scale) / 2 * 100
    rose = f'<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="{D}" fill="{FG}" fill-rule="evenodd" stroke="{FG}" stroke-width="{stroke}" stroke-linejoin="round"/></svg>'
    return f"""<html><body style="margin:0;background:transparent">
    <div style="position:absolute;left:{inset}px;top:{inset}px;width:{inner}px;height:{inner}px;border-radius:{radius}px;background:{BG};box-shadow:{shadow};overflow:hidden">
      <div style="position:absolute;inset:0;border-radius:{radius}px;box-shadow:inset 0 {max(1, size // 512)}px 0 rgba(255,255,255,.22), inset 0 0 0 {max(1, size // 512)}px rgba(0,0,0,.08)"></div>
      <div style="position:absolute;left:{off}%;top:{off}%;width:{scale * 100}%;height:{scale * 100}%">{rose}</div>
    </div></body></html>"""


def render(b, size, **kw):
    pg = b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
    pg.set_content(page(size, **kw))
    png = pg.screenshot(omit_background=True)
    pg.close()
    return Image.open(io.BytesIO(png)).convert('RGBA')


with sync_playwright() as p:
    b = p.chromium.launch()
    # macOS: Big Sur grid (824 px squircle on 1024) with a soft shadow
    mac = {s: render(b, s, inset=round(s * 100 / 1024), radius=round(s * 186 / 1024), scale=0.74,
                     stroke=1.6 if s >= 128 else 2.6, shadow='0 %dpx %dpx rgba(40,20,10,.30)' % (max(1, s // 85), max(1, s // 42)) if s >= 64 else 'none')
           for s in (16, 32, 64, 128, 256, 512, 1024)}
    # Windows: full-bleed rounded tile
    win = {s: render(b, s, inset=0 if s <= 48 else round(s * 8 / 512), radius=round(s * 0.18), scale=0.8 if s <= 48 else 0.76,
                     stroke=3.4 if s <= 24 else 2.6 if s <= 48 else 1.7, shadow='none')
           for s in (16, 24, 32, 48, 64, 128, 256)}
    b.close()

mac[1024].save(os.path.join(BUILD, 'icon.png'))
win[256].save(os.path.join(BUILD, 'icon-win.png'))
win[256].save(os.path.join(ROOT, 'src/renderer/icon.png'))
win[256].save(os.path.join(BUILD, 'icon.ico'), sizes=[(s, s) for s in sorted(win)], append_images=[win[s] for s in sorted(win) if s != 256])

if shutil.which('iconutil'):
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'icon.iconset')
        os.makedirs(iconset)
        for s in (16, 32, 128, 256, 512):
            mac[s].save(os.path.join(iconset, f'icon_{s}x{s}.png'))
            mac[s * 2].save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(BUILD, 'icon.icns')], check=True)
print('icons ok')
