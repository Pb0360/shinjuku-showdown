#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 iOS / iPadOS 的 PWA 启动图（apple-touch-startup-image）

用途：把游戏「添加到主屏幕」后启动时全屏显示这张图，而不是先白闪一下。
用法：
  python tools/gen_ios_splash.py            # 生成图片 + 打印要贴进 index.html 的 link 标签
  python tools/gen_ios_splash.py --tags     # 只打印标签
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
import gen_icon as G

ROOT = G.ROOT
OUT = os.path.join(ROOT, 'src', 'assets', 'splash')

# (逻辑宽, 逻辑高, 缩放) —— 覆盖常见 iPad 的横竖屏
DEVICES = [
    ('ipad-10.2', 768, 1024, 2),
    ('ipad-10.9', 820, 1180, 2),
    ('ipad-pro-11', 834, 1194, 2),
    ('ipad-pro-12.9', 1024, 1366, 2),
    ('ipad-mini', 744, 1133, 2),
]


def draw(w, h):
    """和安卓启动图同款：米白纸面 + 两个球 + 标题"""
    img = Image.new('RGBA', (w, h), G.PAPER)
    d = ImageDraw.Draw(img)
    base = min(w, h)
    r = int(base * 0.105)
    cx1, cy1 = int(w * 0.40), int(h * 0.555)
    cx2, cy2 = int(w * 0.585), int(h * 0.445)

    # 撞击星芒
    mx, my = (cx1 + cx2) // 2, (cy1 + cy2) // 2
    for i in range(8):
        a = math.pi * 2 * i / 8
        L = base * (0.05 if i % 2 == 0 else 0.03)
        d.line([mx, my, mx + math.cos(a) * L, my + math.sin(a) * L],
               fill=(255, 255, 255, 230), width=max(3, int(base * 0.008)))

    G.radial_ball(img, cx2, cy2, r, None, G.RED, G.RED_D)
    G.radial_ball(img, cx1, cy1, r, None, G.BLUE, G.BLUE_D)

    # 标题
    try:
        font = None
        for cand in (r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\msyh.ttc',
                     r'C:\Windows\Fonts\simhei.ttf'):
            if os.path.exists(cand):
                font = ImageFont.truetype(cand, int(base * 0.10))
                break
        if font:
            t = '新宿对决'
            tw = d.textlength(t, font=font)
            d.text(((w - tw) / 2, h * 0.22), t, font=font, fill=(43, 43, 43, 255))
            sub = 'SHINJUKU SHOWDOWN'
            f2 = ImageFont.truetype(font.path, int(base * 0.028))
            sw = d.textlength(sub, font=f2)
            d.text(((w - sw) / 2, h * 0.22 + base * 0.125), sub, font=f2, fill=(167, 159, 146, 255))
    except Exception as e:
        print('  （跳过标题：%s）' % e)

    return img


def main():
    if '--tags' not in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        total = 0
        for name, w, h, scale in DEVICES:
            for orient, (cw, ch) in (('portrait', (w, h)), ('landscape', (h, w))):
                path = os.path.join(OUT, '%s-%s.png' % (name, orient))
                im = draw(cw * scale // 2, ch * scale // 2)   # 2x 的一半分辨率也够清楚，省体积
                im.save(path, optimize=True)
                total += os.path.getsize(path)
        print('已生成 %d 张 iPad 启动图，共 %.2f MB -> %s' % (len(DEVICES) * 2, total / 1048576, OUT))

    print('\n<!-- 把下面这些贴进 index.html 的 <head> -->')
    for name, w, h, scale in DEVICES:
        for orient, (cw, ch) in (('portrait', (w, h)), ('landscape', (h, w))):
            dw, dh = cw * scale, ch * scale
            print('<link rel="apple-touch-startup-image" href="assets/splash/%s-%s.png" '
                  'media="(device-width: %dpx) and (device-height: %dpx) and '
                  '(-webkit-device-pixel-ratio: %d) and (orientation: %s)">'
                  % (name, orient, cw, ch, scale, orient))


if __name__ == '__main__':
    main()
