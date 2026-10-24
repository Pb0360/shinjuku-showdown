#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成游戏图标（Windows .ico + PWA png）
米白纸面 + 一蓝一红两个能量球，和游戏里的视觉一致。

用法：
  python tools/gen_icon.py
产物：
  build/icon.ico                （electron-builder 用，含 16/24/32/48/64/128/256）
  src/assets/icon-512.png       （PWA / Android）
  src/assets/icon-192.png
  src/assets/icon-180.png       （iOS apple-touch-icon）
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')
ASSETS = os.path.join(ROOT, 'src', 'assets')

PAPER = (255, 253, 248, 255)
PAGE = (242, 236, 224, 255)
INK = (43, 43, 43, 255)
BLUE = (59, 130, 246, 255)
BLUE_D = (29, 78, 216, 255)
RED = (139, 26, 26, 255)
RED_D = (74, 13, 13, 255)

S = 1024  # 先画大图再缩，边缘更干净


def radial_ball(img, cx, cy, r, light, main, dark):
    """从左上打光的球体（柔和镜面高光）"""
    d = ImageDraw.Draw(img)
    for i in range(220, 0, -1):
        t = i / 220.0
        rr = r * t
        col = (
            int(dark[0] + (main[0] - dark[0]) * (1 - t)),
            int(dark[1] + (main[1] - dark[1]) * (1 - t)),
            int(dark[2] + (main[2] - dark[2]) * (1 - t)),
            255,
        )
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)

    # 柔和高光：单独一层 + 模糊
    hl = Image.new('RGBA', img.size, (0, 0, 0, 0))
    dh = ImageDraw.Draw(hl)
    hx, hy = cx - r * 0.36, cy - r * 0.38
    hr = r * 0.46
    dh.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 150))
    inner = r * 0.22
    dh.ellipse([hx - inner, hy - inner, hx + inner, hy + inner], fill=(255, 255, 255, 215))
    hl = hl.filter(ImageFilter.GaussianBlur(r * 0.13))
    img.alpha_composite(hl)

    # 描边
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=dark, width=int(r * 0.075))


def make_image(size):
    img = Image.new('RGBA', (S, S), PAGE)
    d = ImageDraw.Draw(img)

    pad = int(S * 0.075)
    # 纸片
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.16), fill=PAPER)
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.16),
                        outline=INK, width=int(S * 0.016))

    # 很淡的方格纸
    step = (S - pad * 2) / 5.0
    for i in range(1, 5):
        x = pad + step * i
        d.line([x, pad + 6, x, S - pad - 6], fill=(43, 43, 43, 22), width=3)
        d.line([pad + 6, x, S - pad - 6, x], fill=(43, 43, 43, 22), width=3)

    r = int(S * 0.185)
    cx1, cy1 = int(S * 0.385), int(S * 0.575)
    cx2, cy2 = int(S * 0.625), int(S * 0.425)

    # 球的投影
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sh)
    ds.ellipse([cx1 - r + 14, cy1 - r + 22, cx1 + r + 14, cy1 + r + 22], fill=(43, 43, 43, 40))
    ds.ellipse([cx2 - r + 14, cy2 - r + 22, cx2 + r + 14, cy2 + r + 22], fill=(43, 43, 43, 40))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.018))
    img.alpha_composite(sh)

    radial_ball(img, cx2, cy2, r, (255, 255, 255, 255), RED, RED_D)   # 宿傩在后
    radial_ball(img, cx1, cy1, r, (255, 255, 255, 255), BLUE, BLUE_D)  # 五条悟在前

    # 中间一小撮"撞击"星芒
    mx, my = (cx1 + cx2) // 2, (cy1 + cy2) // 2
    spark = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dsp = ImageDraw.Draw(spark)
    import math
    for i in range(8):
        a = math.pi * 2 * i / 8
        L = S * (0.085 if i % 2 == 0 else 0.05)
        dsp.line([mx, my, mx + math.cos(a) * L, my + math.sin(a) * L],
                 fill=(255, 255, 255, 235), width=int(S * 0.014))
    dsp.ellipse([mx - S * 0.028, my - S * 0.028, mx + S * 0.028, my + S * 0.028],
                fill=(255, 255, 255, 245))
    img.alpha_composite(spark)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    big = make_image(512)
    big.save(os.path.join(BUILD, 'icon.png'))

    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    big.save(os.path.join(BUILD, 'icon.ico'), sizes=ico_sizes)

    for sz, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'icon-180.png')]:
        make_image(sz).save(os.path.join(ASSETS, name))

    print('已生成：')
    print('  ' + os.path.join(BUILD, 'icon.ico'))
    print('  ' + os.path.join(BUILD, 'icon.png'))
    for n in ('icon-512.png', 'icon-192.png', 'icon-180.png'):
        print('  ' + os.path.join(ASSETS, n))


if __name__ == '__main__':
    main()
