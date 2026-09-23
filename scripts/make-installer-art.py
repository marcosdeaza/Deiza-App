#!/usr/bin/env python3
"""Installer artwork (needs Playwright + Pillow; macOS tiffutil for the retina DMG background).

  build/background.tiff        DMG window background, 660x420 @1x + @2x (kraft paper, riso inks)
  build/installerSidebar.bmp   NSIS welcome/finish sidebar, 164x314
  build/installerHeader.bmp    NSIS header, 150x57
"""
import io, os, re, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
BUILD = os.path.join(ROOT, 'build')
D = re.search(r' d="([^"]+)"', open(os.path.join(BUILD, 'rose.svg')).read()).group(1)
FONTS = "<link href='https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500&display=swap' rel='stylesheet'>"

def rose(fill, extra=''):
    return f'<svg viewBox="0 0 100 100" width="100%" height="100%" style="display:block;overflow:visible"><path d="{D}" fill="{fill}" fill-rule="evenodd" {extra}/></svg>'

GRAIN = ("<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' "
         "baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .12  0 0 0 0 .08  0 0 0 0 .05  0 0 0 .55 0'/></filter>"
         "<rect width='100%' height='100%' filter='url(%23n)'/></svg>")
FIBERS = ("<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'><filter id='f'><feTurbulence type='fractalNoise' "
          "baseFrequency='.012 .09' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 .95  0 0 0 0 .85  0 0 0 .22 -.02'/></filter>"
          "<rect width='100%' height='100%' filter='url(%23f)'/></svg>")

DMG = f"""<html><head>{FONTS}</head><body style="margin:0">
<div style="position:relative;width:660px;height:420px;overflow:hidden;background:radial-gradient(120% 90% at 30% 20%,#8d7964 0%,#806c58 55%,#735f4d 100%);font-family:Inter,sans-serif">
  <div style="position:absolute;inset:0;background-image:url(&quot;data:image/svg+xml;utf8,{FIBERS}&quot;);mix-blend-mode:screen;opacity:.55"></div>
  <div style="position:absolute;right:-70px;bottom:-90px;width:330px;height:330px;opacity:.10">{rose('#f6ead6')}</div>
  <div style="position:absolute;left:34px;top:30px;display:flex;align-items:center;gap:12px">
    <div style="width:30px;height:30px;position:relative">
      <div style="position:absolute;left:2px;top:2px;width:30px;height:30px;opacity:.9">{rose('#7a1d2a')}</div>
      <div style="position:absolute;inset:0">{rose('#f6ead6')}</div>
    </div>
    <div>
      <div style="font:500 25px/1 'Playfair Display',Georgia,serif;color:#f6ead6;letter-spacing:-.01em">Deiza</div>
      <div style="font:400 11.5px/1.3 Inter,sans-serif;color:#f1e3cc;opacity:.85;margin-top:4px">para escritorio</div>
    </div>
  </div>
  <svg width="660" height="420" style="position:absolute;inset:0" viewBox="0 0 660 420">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M262 186 C 310 142, 360 140, 398 178" stroke="#7a1d2a" stroke-width="5" transform="translate(2 3)" opacity=".9"/>
      <path d="M380 174 L 399 180 L 395 160" stroke="#7a1d2a" stroke-width="5" transform="translate(2 3)" opacity=".9"/>
      <path d="M262 186 C 310 142, 360 140, 398 178" stroke="#f6ead6" stroke-width="3.2"/>
      <path d="M380 174 L 399 180 L 395 160" stroke="#f6ead6" stroke-width="3.2"/>
    </g>
  </svg>
  <div style="position:absolute;inset:0;background-image:url(&quot;data:image/svg+xml;utf8,{GRAIN}&quot;);mix-blend-mode:multiply;opacity:.55"></div>
</div></body></html>"""

SIDEBAR = f"""<html><head>{FONTS}</head><body style="margin:0">
<div style="position:relative;width:164px;height:314px;overflow:hidden;background:linear-gradient(180deg,#9a2a3a 0%,#6f1824 100%);font-family:Inter,sans-serif">
  <div style="position:absolute;left:-40px;bottom:-46px;width:190px;height:190px;opacity:.12">{rose('#f7ecdc')}</div>
  <div style="position:absolute;left:36px;top:42px;width:92px;height:92px">{rose('#f7ecdc', 'stroke="#f7ecdc" stroke-width="1.6" stroke-linejoin="round"')}</div>
  <div style="position:absolute;left:0;right:0;top:152px;text-align:center;font:500 30px/1 'Playfair Display',Georgia,serif;color:#f7ecdc;letter-spacing:-.01em">Deiza</div>
  <div style="position:absolute;left:0;right:0;top:190px;text-align:center;font:400 11px/1.35 Inter,sans-serif;color:#f3dfd0;opacity:.9">Chat y Code<br>en tu escritorio</div>
</div></body></html>"""

HEADER = f"""<html><head>{FONTS}</head><body style="margin:0">
<div style="position:relative;width:150px;height:57px;overflow:hidden;background:#ffffff;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-right:12px;box-sizing:border-box">
  <div style="font:500 21px/1 'Playfair Display',Georgia,serif;color:#6f1824">Deiza</div>
  <div style="width:30px;height:30px">{rose('#8e2433', 'stroke="#8e2433" stroke-width="1.8" stroke-linejoin="round"')}</div>
</div></body></html>"""

def shot(b, html, w, h, scale):
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=scale)
    pg.set_content(html)
    pg.wait_for_timeout(900)
    png = pg.screenshot()
    pg.close()
    return Image.open(io.BytesIO(png)).convert('RGB')

with sync_playwright() as p:
    b = p.chromium.launch()
    dmg1 = shot(b, DMG, 660, 420, 1)
    dmg2 = shot(b, DMG, 660, 420, 2)
    side = shot(b, SIDEBAR, 164, 314, 1)
    head = shot(b, HEADER, 150, 57, 1)
    b.close()

dmg1.save(os.path.join(BUILD, 'dmg-background.png'))
dmg2.save(os.path.join(BUILD, 'dmg-background@2x.png'))
if shutil.which('tiffutil'):
    subprocess.run(['tiffutil', '-cathidpicheck', os.path.join(BUILD, 'dmg-background.png'), os.path.join(BUILD, 'dmg-background@2x.png'),
                    '-out', os.path.join(BUILD, 'background.tiff')], check=True, capture_output=True)
side.save(os.path.join(BUILD, 'installerSidebar.bmp'))
side.save(os.path.join(BUILD, 'uninstallerSidebar.bmp'))
head.save(os.path.join(BUILD, 'installerHeader.bmp'))
print('installer art ok')
