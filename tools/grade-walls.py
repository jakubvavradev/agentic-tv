#!/usr/bin/env python3
"""Finish raw month renders (tools/render-months.js) into launcher wallpapers:
<MM>-<slot>-bg.webp / -fg.webp (graded layers), -clear.webp (light blur, Clear glass), -blur.webp (heavy blur, grid veil).
No painted-on stars: only the scene's own stars, which its clouds already cover.
usage: grade-walls.py RAW_DIR OUT_DIR"""
import sys, glob, os
from PIL import Image, ImageEnhance, ImageFilter

raw, out = sys.argv[1], sys.argv[2]
NIGHT = [min(255, int(255 * ((i / 255) ** 0.55) * 1.15)) for i in range(256)]

def grade(im, night):
    a = im.split()[3] if im.mode == 'RGBA' else None
    rgb = im.convert('RGB')
    if night:   # night is rendered at ~3x exposure (render-months.js), so only a gentle blue grade is needed (no banding)
        r, g, b = rgb.split()
        lut = [min(255, int(255 * ((v / 255) ** 0.85) * 0.95)) for v in range(256)]
        rgb = Image.merge('RGB', (r.point([int(v * .8) for v in lut]), g.point([int(v * .9) for v in lut]), b.point(lambda v: min(255, int(lut[v] * 1.15) + 4))))
    else:
        rgb = ImageEnhance.Color(ImageEnhance.Contrast(rgb).enhance(1.12)).enhance(1.25)
    if a: rgb.putalpha(a)
    return rgb

for bgp in sorted(glob.glob(os.path.join(raw, '*-bg.png'))):
    key = os.path.basename(bgp)[:-7]                      # "MM-slot"
    fgp = os.path.join(raw, key + '-fg.png')
    if not os.path.exists(fgp): continue
    night = key.endswith('night')
    bg, fg = grade(Image.open(bgp), night), grade(Image.open(fgp), night)
    bg.save(os.path.join(out, key + '-bg.webp'), quality=86)
    fg.save(os.path.join(out, key + '-fg.webp'), quality=88)
    comp = Image.alpha_composite(bg.convert('RGBA'), fg.convert('RGBA')).convert('RGB')
    ImageEnhance.Color(comp.resize((960, 540)).filter(ImageFilter.GaussianBlur(7))).enhance(1.35).save(os.path.join(out, key + '-clear.webp'), quality=82)
    ImageEnhance.Color(comp.resize((480, 270)).filter(ImageFilter.GaussianBlur(10))).enhance(1.6).save(os.path.join(out, key + '-blur.webp'), quality=80)
    print(key)
