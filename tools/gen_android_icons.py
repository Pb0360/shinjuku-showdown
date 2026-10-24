#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成安卓工程用的图标与启动图（覆盖 Capacitor 默认的占位图）

用法：
  python tools/gen_android_icons.py
产物（全部写进 android/app/src/main/res/）：
  mipmap-*/ic_launcher.png            传统方形图标
  mipmap-*/ic_launcher_round.png      圆形图标
  mipmap-*/ic_launcher_foreground.png 自适应图标的前景层（透明底，内容在安全区内）
  drawable*/splash.png                各方向/各密度的启动图
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFilter
import gen_icon as G

ROOT = G.ROOT
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

# 密度 -> 倍率（1dp = 1px @ mdpi）
DENS = [('mdpi', 1.0), ('hdpi', 1.5), ('xhdpi', 2.0), ('xxhdpi', 3.0), ('xxxhdpi', 4.0)]

PAPER = G.PAPER
PAGE = G.PAGE
INK = G.INK


def sheet(w, h, radius_ratio=None):
    """一张米白纸片，带细墨边"""
    img = Image.new('RGBA', (w, h), PAGE)
    d = ImageDraw.Draw(img)
    if radius_ratio:
        pad = int(min(w, h) * 0.05)
        d.rounded_rectangle([pad, pad, w - pad, h - pad], radius=int(min(w, h) * radius_ratio),
                            fill=PAPER, outline=INK, width=max(2, int(min(w, h) * 0.012)))
    else:
        d.rectangle([0, 0, w, h], fill=PAPER)
    return img


def foreground(size):
    """自适应图标前景：透明底 + 两个球，内容控制在中间 66% 的安全区里"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    r = int(size * 0.205)
    cx1, cy1 = int(size * 0.39), int(size * 0.575)
    cx2, cy2 = int(size * 0.615), int(size * 0.43)
    # 撞击星芒
    mx, my = (cx1 + cx2) // 2, (cy1 + cy2) // 2
    spark = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ds = ImageDraw.Draw(spark)
    for i in range(8):
        a = math.pi * 2 * i / 8
        L = size * (0.085 if i % 2 == 0 else 0.05)
        ds.line([mx, my, mx + math.cos(a) * L, my + math.sin(a) * L],
                fill=(255, 255, 255, 235), width=max(2, int(size * 0.014)))
    ds.ellipse([mx - size * 0.028, my - size * 0.028, mx + size * 0.028, my + size * 0.028],
               fill=(255, 255, 255, 245))
    G.radial_ball(img, cx2, cy2, r, None, G.RED, G.RED_D)
    G.radial_ball(img, cx1, cy1, r, None, G.BLUE, G.BLUE_D)
    img.alpha_composite(spark)
    return img


def round_icon(size):
    """圆形图标：把方形图标裁成圆"""
    base = G.make_image(size)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def splash(w, h):
    """启动图：米白纸面 + 两个球 + 标题"""
    img = sheet(w, h)
    d = ImageDraw.Draw(img)
    base = min(w, h)
    r = int(base * 0.115)
    cx1, cy1 = int(w * 0.40), int(h * 0.565)
    cx2, cy2 = int(w * 0.585), int(h * 0.44)

    # 撞击星芒
    mx, my = (cx1 + cx2) // 2, (cy1 + cy2) // 2
    for i in range(8):
        a = math.pi * 2 * i / 8
        L = base * (0.05 if i % 2 == 0 else 0.03)
        d.line([mx, my, mx + math.cos(a) * L, my + math.sin(a) * L],
               fill=(255, 255, 255, 230), width=max(2, int(base * 0.008)))

    G.radial_ball(img, cx2, cy2, r, None, G.RED, G.RED_D)
    G.radial_ball(img, cx1, cy1, r, None, G.BLUE, G.BLUE_D)

    # 标题（找不到中文字体就跳过，不影响出图）
    title = '新宿对决'
    try:
        from PIL import ImageFont
        font = None
        for cand in (r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\msyh.ttc',
                     r'C:\Windows\Fonts\simhei.ttf'):
            if os.path.exists(cand):
                font = ImageFont.truetype(cand, int(base * 0.115))
                break
        if font:
            tw = d.textlength(title, font=font)
            d.text(((w - tw) / 2, h * 0.20), title, font=font, fill=(43, 43, 43, 255))
    except Exception as e:
        print('  （跳过标题：%s）' % e)

    return img


def main():
    if not os.path.isdir(RES):
        print('找不到安卓工程：' + RES)
        print('请先执行： npx cap add android')
        return

    made = 0
    # ---- 图标 ----
    for name, scale in DENS:
        folder = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(folder, exist_ok=True)
        legacy = int(48 * scale)
        adapt = int(108 * scale)
        G.make_image(legacy).save(os.path.join(folder, 'ic_launcher.png'))
        round_icon(legacy).save(os.path.join(folder, 'ic_launcher_round.png'))
        foreground(adapt).save(os.path.join(folder, 'ic_launcher_foreground.png'))
        made += 3
    # 自适应图标背景色 = 米白
    for p in (os.path.join(RES, 'values', 'ic_launcher_background.xml'),):
        try:
            with open(p, 'w', encoding='utf-8') as f:
                f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                        '<resources>\n'
                        '    <color name="ic_launcher_background">#F2ECE0</color>\n'
                        '</resources>\n')
            made += 1
        except Exception as e:
            print('  写背景色失败：%s' % e)

    # ---- 启动图 ----
    splashes = [
        (os.path.join(RES, 'drawable', 'splash.png'), 480, 480),
        (os.path.join(RES, 'drawable-port-mdpi', 'splash.png'), 320, 480),
        (os.path.join(RES, 'drawable-port-hdpi', 'splash.png'), 480, 800),
        (os.path.join(RES, 'drawable-port-xhdpi', 'splash.png'), 720, 1280),
        (os.path.join(RES, 'drawable-port-xxhdpi', 'splash.png'), 1080, 1920),
        (os.path.join(RES, 'drawable-port-xxxhdpi', 'splash.png'), 1440, 2560),
        (os.path.join(RES, 'drawable-land-mdpi', 'splash.png'), 480, 320),
        (os.path.join(RES, 'drawable-land-hdpi', 'splash.png'), 800, 480),
        (os.path.join(RES, 'drawable-land-xhdpi', 'splash.png'), 1280, 720),
        (os.path.join(RES, 'drawable-land-xxhdpi', 'splash.png'), 1920, 1080),
        (os.path.join(RES, 'drawable-land-xxxhdpi', 'splash.png'), 2560, 1440),
    ]
    for path, w, h in splashes:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        splash(w, h).save(path)
        made += 1

    print('已生成 %d 个安卓资源文件：' % made)
    print('  图标: ' + os.path.join(RES, 'mipmap-*'))
    print('  启动图: ' + os.path.join(RES, 'drawable*', 'splash.png'))


if __name__ == '__main__':
    main()
