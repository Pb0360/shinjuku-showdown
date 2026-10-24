# -*- coding: utf-8 -*-
"""
新宿对决 —— 音效程序化合成脚本
=================================================
只依赖 numpy + 标准库 wave，可重复运行、可调参。

设计基调（对齐"米白色极简风"美术）：
  * 干净、圆润、克制；以正弦 / 三角波 / 柔和噪声 / 带通滤波 / 轻混响为主
  * 避开刺耳高频、避开重低音轰头、避开金属味合成器
  * 木质 / 纸感 / 水感，音量偏轻

规格：
  WAV / 16-bit PCM / 单声道 / 44100 Hz
  音效峰值归一化到 -3 dBFS (0.7)，BGM 到 -10 dBFS (0.316)
  去除直流、结尾 10ms 淡出（BGM 为无缝循环，不做淡出）

运行：
  & "<python>" "D:\\AI工作目录4\\新宿对决\\tools\\gen_sfx.py"
  & "<python>" "...\\gen_sfx.py" --only black_flash cast_sukuna3   # 只重生成部分
"""

import os
import sys
import math
import wave

import numpy as np

# ----------------------------------------------------------------------------
# 全局参数（要调音色，基本只动这里）
# ----------------------------------------------------------------------------
SR = 44100
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'src', 'assets', 'audio', 'sfx'))

P = {
    # 电平
    'peak_sfx': 0.70,       # -3.1 dBFS
    'peak_bgm': 0.316,      # -10.0 dBFS
    # 首尾处理
    'fade_in': 0.0015,      # 1.5ms 淡入，保证首样本为 0
    'fade_out': 0.010,      # 10ms 淡出，防爆音
    'dc_block_hz': 25.0,    # 去直流用的一阶高通
    # 混响
    'verb_decay': 0.35,     # 混响尾巴长度（秒，衰减到 -60dB）
    'verb_mix': 0.26,       # 干湿比
    'verb_damp': 3600.0,    # 混响阻尼低通（越低越"纸感"）
    'verb_predelay': 0.012,
    # 亮度上限：整体封住刺耳高频
    'air_cap': 9000.0,
}

# 常用音色比例
WOOD_PARTIALS = ((1.00, 1.00), (2.76, 0.30), (5.40, 0.12))          # 木块 / 马林巴
GLASS_PARTIALS = ((1.00, 1.00), (2.01, 0.45), (3.01, 0.22), (4.60, 0.10))  # 玻璃 / 叮
BELL_PARTIALS = ((1.00, 1.00), (2.40, 0.35), (4.20, 0.14), (6.10, 0.06))   # 铃


# ----------------------------------------------------------------------------
# 基础工具
# ----------------------------------------------------------------------------
def n_of(dur, sr=SR):
    """秒 -> 采样数"""
    return max(1, int(round(dur * sr)))


def t_of(n, sr=SR):
    return np.arange(n) / sr


def fit(x, dur, sr=SR):
    """把信号裁剪 / 补零到指定时长"""
    n = n_of(dur, sr)
    if len(x) >= n:
        return x[:n].copy()
    return np.pad(x, (0, n - len(x)))


def pad_to(x, n):
    if len(x) >= n:
        return x[:n]
    return np.pad(x, (0, n - len(x)))


def add_at(n, sig, start, sr=SR):
    """把 sig 叠加到长度为 n 的缓冲区的 start 秒处"""
    buf = np.zeros(n)
    i = int(round(start * sr))
    if i >= n:
        return buf
    seg = sig[:n - i]
    buf[i:i + len(seg)] += seg
    return buf


def mix(*layers):
    """多层等长/不等长叠加"""
    n = max(len(l) for l in layers)
    out = np.zeros(n)
    for l in layers:
        out[:len(l)] += l
    return out


# ----------------------------------------------------------------------------
# 振荡器 / 噪声
# ----------------------------------------------------------------------------
def sweep_freq(f0, f1, n, curve=1.0):
    """对数扫频控制序列（f0>0, f1>0），curve>1 表示前慢后快"""
    u = np.linspace(0.0, 1.0, n) ** curve
    return f0 * (f1 / f0) ** u


def sine_f(freqs, amp=1.0, phase=0.0, sr=SR):
    """按瞬时频率序列生成正弦（freqs 可为标量或数组）"""
    freqs = np.asarray(freqs, dtype=float)
    if freqs.ndim == 0:
        n = 1
        ph = 2 * np.pi * float(freqs) * t_of(n, sr)
    else:
        ph = 2 * np.pi * np.cumsum(freqs) / sr
    return amp * np.sin(ph + phase)


def sine(freq, dur, amp=1.0, phase=0.0, sr=SR):
    n = n_of(dur, sr)
    return amp * np.sin(2 * np.pi * freq * t_of(n, sr) + phase)


def tri_f(freqs, amp=1.0, sr=SR):
    """三角波（比锯齿柔和，谐波衰减快）"""
    freqs = np.asarray(freqs, dtype=float)
    if freqs.ndim == 0:
        ph = 2 * np.pi * float(freqs) * t_of(1, sr)
    else:
        ph = 2 * np.pi * np.cumsum(freqs) / sr
    return amp * (2.0 / np.pi) * np.arcsin(np.sin(ph))


def tri(freq, dur, amp=1.0, sr=SR):
    n = n_of(dur, sr)
    return tri_f(np.full(n, float(freq)), amp=amp, sr=sr)


def noise(dur, seed=0, sr=SR):
    """均匀白噪声，峰值 ±1"""
    n = n_of(dur, sr)
    rng = np.random.default_rng(seed)
    return rng.uniform(-1.0, 1.0, n)


def lfo(dur, rate, depth=1.0, offset=1.0, phase=0.0, sr=SR):
    """低频调制（用于颤音 / 脉动）"""
    n = n_of(dur, sr)
    return offset + depth * np.sin(2 * np.pi * rate * t_of(n, sr) + phase)


# ----------------------------------------------------------------------------
# 滤波器（FFT 幅频整形，零相位；loop=True 时用循环卷积保证首尾相接）
# ----------------------------------------------------------------------------
def _filt(x, gain_fn, sr=SR, circular=False):
    n = len(x)
    if circular:
        nfft = n
    else:
        nfft = 1 << int(math.ceil(math.log2(max(2 * n, 8))))
    X = np.fft.rfft(x, nfft)
    f = np.fft.rfftfreq(nfft, 1.0 / sr)
    X = X * gain_fn(f)
    return np.fft.irfft(X, nfft)[:n]


def _lp_gain(f, fc, order):
    return 1.0 / np.sqrt(1.0 + (f / max(fc, 1e-6)) ** (2 * order))


def _hp_gain(f, fc, order):
    r = f / max(fc, 1e-6)
    return (r ** order) / np.sqrt(1.0 + r ** (2 * order))


def lowpass(x, fc, order=2, sr=SR, circular=False):
    return _filt(x, lambda f: _lp_gain(f, fc, order), sr, circular)


def highpass(x, fc, order=2, sr=SR, circular=False):
    return _filt(x, lambda f: _hp_gain(f, fc, order), sr, circular)


def bandpass(x, lo, hi, order=2, sr=SR, circular=False):
    return _filt(x, lambda f: _hp_gain(f, lo, order) * _lp_gain(f, hi, order), sr, circular)


def bandpass_sweep(x, f0, f1, sr=SR, win=0.02, order=2, q=1.0):
    """随时间移动中心频率的带通（重叠相加，用于"破空 / 切割"类噪声）"""
    n = len(x)
    hop = max(16, int(win * sr))
    wn = hop * 2
    w = np.hanning(wn)
    out = np.zeros(n + wn)
    pos = 0
    while pos < n:
        seg = pad_to(x[pos:pos + wn], wn)
        frac = min(1.0, pos / max(1, n))
        fc = f0 * (f1 / f0) ** frac
        seg = _filt(seg, lambda f: _hp_gain(f, fc / q, order) * _lp_gain(f, fc * q, order), sr)
        out[pos:pos + wn] += seg * w
        pos += hop
    return out[:n]


def crackle(dur, seed=0, rate=120, lo=1400.0, hi=6000.0, sr=SR):
    """稀疏颗粒噪声（火焰 / 静电的"沙沙"）"""
    n = n_of(dur, sr)
    rng = np.random.default_rng(seed)
    imp = np.zeros(n)
    idx = rng.random(n) < (rate / sr)
    imp[idx] = rng.uniform(0.3, 1.0, int(idx.sum()))
    imp = _filt(imp, lambda f: _lp_gain(f, 7000.0, 1), sr)
    return bandpass(imp, lo, hi, order=2, sr=sr)


# ----------------------------------------------------------------------------
# 包络
# ----------------------------------------------------------------------------
def env_ad(n, attack, decay, floor=1e-3):
    """attack(线性升) + 指数衰减到 floor（decay 秒）"""
    t = t_of(n)
    tau = max(decay / math.log(1.0 / floor), 1e-5)
    e = np.exp(-t / tau)
    a = max(1, int(round(attack * SR)))
    if a > 1:
        ramp = np.ones(n)
        ramp[:a] = np.linspace(0.0, 1.0, a) ** 1.5
        e = e * ramp
    return e


def env_swell(n, attack, release, hold_flat=True):
    """升-保持-降 的凸包络（用于 pad / 能量成型）"""
    e = np.ones(n)
    a = max(1, int(round(attack * SR)))
    r = max(1, int(round(release * SR)))
    if a + r > n:
        a = max(1, int(n * 0.5))
        r = max(1, n - a)
    e[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    e[n - r:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(r) / r)
    return e


def env_ar(n, attack, release):
    return env_swell(n, attack, release)


def fade(x, fade_in=0.0, fade_out=0.0, sr=SR):
    y = x.copy()
    a = int(round(fade_in * sr))
    b = int(round(fade_out * sr))
    if a > 1:
        y[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 1:
        y[-b:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b)
    return y


def normalize(x, peak=0.7):
    m = float(np.max(np.abs(x))) if len(x) else 0.0
    if m < 1e-12:
        return x
    return x * (peak / m)


def shave(x, ceiling=0.92, win_ms=3.0, smooth_ms=25.0, sr=SR):
    """零相位削峰（不是削波，不会产生谐波失真）：
    用滑动包络把孤立尖峰压到 ceiling 以下，让噪声类音效的"身体"不至于
    被某一个采样点吃掉全部动态余量 —— 归一化后听起来更饱满、更不刺耳。"""
    n = len(x)
    if n == 0:
        return x
    b = max(1, int(win_ms / 1000.0 * sr) // 2)
    xp = np.pad(np.abs(x), (0, (-n) % b))
    blk = xp.reshape(-1, b).max(axis=1)
    blk = np.maximum(blk, np.roll(blk, 1))
    env = np.repeat(blk, b)[:n]
    g = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
    g = lowpass(g, 1000.0 / max(smooth_ms, 0.1), order=2, sr=sr)   # 平滑增益曲线
    return x * np.clip(g, 0.0, 1.0)


def crest_db(x):
    """波峰因数：峰值 / 有效值，越大说明越"尖"（同样峰值下听着越轻）"""
    r = float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0
    p = float(np.max(np.abs(x))) if len(x) else 0.0
    return 20 * math.log10(p / r) if r > 0 else 0.0


# ----------------------------------------------------------------------------
# 组合基元：音色 / 混响 / 循环
# ----------------------------------------------------------------------------
def tone(freq, dur, attack=0.004, decay=None, amp=1.0,
         partials=WOOD_PARTIALS, sr=SR, bright=1.0):
    """泛音堆叠音色（默认木质）"""
    n = n_of(dur, sr)
    if decay is None:
        decay = dur * 0.45
    out = np.zeros(n)
    norm = sum(p for _, p in partials)
    for mult, pa in partials:
        f = freq * mult * bright
        if f > SR * 0.45:
            continue
        out += pa * np.sin(2 * np.pi * f * t_of(n, sr))
    return amp * env_ad(n, attack, decay) * out / max(norm, 1e-9)


def bell(freq, dur, amp=1.0, partials=BELL_PARTIALS, sr=SR, attack=0.002):
    """铃 / 玻璃：高泛音衰减更快"""
    n = n_of(dur, sr)
    out = np.zeros(n)
    for i, (mult, pa) in enumerate(partials):
        f = freq * mult
        if f > SR * 0.45:
            continue
        d = dur / (1.0 + 0.8 * i)
        out += pa * np.sin(2 * np.pi * f * t_of(n, sr)) * env_ad(n, attack, d)
    return amp * out


def _conv_fft(x, h, sr=SR, length=None):
    n = len(x) + len(h) - 1
    nfft = 1 << int(math.ceil(math.log2(max(n, 8))))
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)
    if length is None:
        return y
    return y[:length]


def reverb(x, decay=None, mix_amt=None, damp=None, predelay=None, seed=7, sr=SR, circular=False):
    """柔和混响尾巴：衰减噪声当 IR（低通后没有金属味）"""
    decay = P['verb_decay'] if decay is None else decay
    mix_amt = P['verb_mix'] if mix_amt is None else mix_amt
    damp = P['verb_damp'] if damp is None else damp
    predelay = P['verb_predelay'] if predelay is None else predelay
    n_ir = max(64, n_of(decay, sr))
    rng = np.random.default_rng(seed)
    ir = rng.uniform(-1.0, 1.0, n_ir) * np.exp(-np.arange(n_ir) / (n_ir / 6.9))
    ir = _filt(ir, lambda f: _lp_gain(f, damp, 2), sr)
    ir[:max(1, int(predelay * sr))] *= 0.15
    ir *= 1.0 / (np.sqrt(np.sum(ir ** 2)) + 1e-9)
    if circular:
        nfft = len(x)
        wet = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)
        wet = wet * (0.35 / (np.max(np.abs(wet)) + 1e-9)) * 3.0
        wet = wet / max(1e-9, np.sqrt(np.mean(wet ** 2))) * np.sqrt(np.mean(x ** 2) + 1e-12)
    else:
        wet = _conv_fft(x, ir, sr, length=len(x))
        wet = wet / (np.max(np.abs(wet)) + 1e-9) * (np.max(np.abs(x)) + 1e-9)
    return x * (1.0 - mix_amt) + wet * mix_amt


def reverb_tail(x, decay=None, mix_amt=None, damp=None, predelay=None,
                seed=7, sr=SR, circular=False):
    """reverb 的别名，语义更明确：给一个音效加"混响尾巴" """
    return reverb(x, decay=decay, mix_amt=mix_amt, damp=damp,
                  predelay=predelay, seed=seed, sr=sr, circular=circular)


def q_freq(f, loop):
    """把频率量化到 loop 秒的整数周期上 —— 循环 BGM 相位连续的秘诀"""
    return max(0.02, round(f * loop) / loop)


def circ_add(buf, sig, start, sr=SR):
    """循环叠加：超过末尾的部分绕回开头，保证周期信号严格无缝"""
    n = len(buf)
    i = int(round(start * sr)) % n
    idx = (np.arange(len(sig)) + i) % n
    np.add.at(buf, idx, sig)
    return buf


def pad_note(freqs, dur, loop, amp=1.0, attack=1.2, release=1.8, seed=0, sr=SR):
    """BGM 用的慢速 pad 和弦：每个频率都量化到循环网格"""
    n = n_of(dur, sr)
    e = env_swell(n, attack, release)
    out = np.zeros(n)
    rng = np.random.default_rng(seed)
    for f in freqs:
        fq = q_freq(f, loop)
        det = q_freq(f * 1.0025, loop)
        out += 0.85 * np.sin(2 * np.pi * fq * t_of(n, sr) + rng.uniform(0, 6.28))
        out += 0.30 * np.sin(2 * np.pi * det * t_of(n, sr) + rng.uniform(0, 6.28))
        out += 0.14 * tri_f(np.full(n, q_freq(f * 0.5, loop)))
    return amp * e * out / (len(freqs) * 1.3)


# ----------------------------------------------------------------------------
# 保存 + 校验
# ----------------------------------------------------------------------------
def save(name, x, loop=False, peak=None, sr=SR, shave_peaks=False):
    """去直流 -> 淡入淡出 -> (可选削峰) -> 归一化 -> 写 16bit PCM 单声道 WAV"""
    peak = (P['peak_bgm'] if loop else P['peak_sfx']) if peak is None else peak
    y = highpass(x, P['dc_block_hz'], order=2, sr=sr, circular=loop)
    if not loop:
        y = fade(y, P['fade_in'], P['fade_out'], sr)
    y = normalize(y, 0.92)
    if shave_peaks:
        y = shave(y, ceiling=0.90, win_ms=3.0, smooth_ms=25.0, sr=sr)
    y = normalize(y, peak)
    y = lowpass(y, P['air_cap'], order=2, sr=sr, circular=loop)
    y = normalize(y, peak)
    y = np.clip(y, -1.0, 1.0)
    data = np.round(y * 32767.0).astype('<i2')
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())
    return path


def read_wav(path):
    with wave.open(path, 'rb') as w:
        ch, sw, fr, nf = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(nf)
    a = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    return a, ch, sw, fr, nf


def verify(paths, loops=()):
    """回读校验：采样率 / 声道 / 时长 / 峰值 / 直流 / 首样本 / 循环接缝 / 文件大小"""
    rows = []
    ok = True
    for p in paths:
        name = os.path.basename(p)
        size = os.path.getsize(p)
        a, ch, sw, fr, nf = read_wav(p)
        dur = nf / fr
        peak = float(np.max(np.abs(a))) if nf else 0.0
        dc = float(np.mean(a)) if nf else 0.0                      # 真正的直流分量
        first = float(abs(a[0])) if nf else 0.0                    # 首样本应为 0
        last = float(abs(a[-1])) if nf else 0.0
        db = 20 * math.log10(peak) if peak > 0 else -99
        is_loop = name in loops
        bad = []
        if ch != 1 or sw != 2 or fr != SR:
            bad.append('格式')
        if size <= 1024:
            bad.append('体积')
        if not (0.05 <= dur <= 25.5):
            bad.append('时长')
        if abs(dc) > 0.005:
            bad.append('直流')
        if not is_loop and first > 0.002:
            bad.append('首样本非零')
        if is_loop:
            # 循环接缝：首尾样本落差应和普通相邻样本落差同量级
            d = abs(float(a[0]) - float(a[-1]))
            ref = float(np.median(np.abs(np.diff(a)))) + 1e-9
            seam = d / ref
            if seam > 60.0:
                bad.append('接缝')
        else:
            seam = 0.0
            if last > 0.01:
                bad.append('末尾未淡出')
        if bad:
            ok = False
        rows.append((name, dur, db, size, dc, first, seam, ','.join(bad) or 'ok', crest_db(a)))
    print('\n%-24s %8s %7s %9s %9s %8s %7s %6s  %s' %
          ('文件', '时长(s)', '峰值dB', '大小(B)', '整体DC', '首样本', '接缝x', '波峰dB', '校验'))
    print('-' * 108)
    for name, dur, db, size, dc, first, seam, flag, crest in rows:
        print('%-24s %8.3f %7.2f %9d %9.5f %8.5f %7.1f %6.1f  %s' %
              (name, dur, db, size, dc, first, seam, crest, flag))
    total = sum(r[3] for r in rows)
    print('-' * 108)
    print('共 %d 个文件，总大小 %.1f KB (%.2f MB)，全部校验%s' %
          (len(rows), total / 1024, total / 1048576, '通过' if ok else '存在问题'))
    return ok


# ============================================================================
# 音效定义
# ============================================================================
def ui_click():
    d = 0.08
    click = tone(1180.0, d, attack=0.0006, decay=0.022, amp=1.0, partials=WOOD_PARTIALS)
    body = tone(560.0, d, attack=0.001, decay=0.035, amp=0.55, partials=WOOD_PARTIALS)
    tick = bandpass(noise(d, 11), 1200.0, 5200.0) * env_ad(n_of(d), 0.0004, 0.006) * 0.5
    return lowpass(mix(click, body, tick), 7000.0)


def ui_hover():
    d = 0.06
    t1 = tone(1720.0, d, attack=0.001, decay=0.018, amp=0.42, partials=WOOD_PARTIALS)
    air = bandpass(noise(d, 21), 1800.0, 6000.0) * env_ad(n_of(d), 0.0006, 0.008) * 0.30
    return lowpass(mix(t1, air), 7500.0)


def countdown():
    d = 0.3
    ding = bell(784.0, d, amp=0.9, partials=((1.0, 1.0), (2.40, 0.26), (3.95, 0.10)))
    soft = tone(392.0, d, attack=0.004, decay=0.18, amp=0.30, partials=((1.0, 1.0), (2.0, 0.18)))
    return reverb(mix(ding, soft), decay=0.28, mix_amt=0.22, damp=4200.0, seed=31)


def round_start():
    d = 0.6
    a = tone(440.0, 0.30, attack=0.006, decay=0.22, amp=0.75,
             partials=((1.0, 1.0), (2.0, 0.22), (3.0, 0.08)))
    b = tone(660.0, 0.34, attack=0.008, decay=0.26, amp=0.85,
             partials=((1.0, 1.0), (2.0, 0.22), (3.0, 0.08)))
    sig = mix(add_at(n_of(d), a, 0.0), add_at(n_of(d), b, 0.24))
    return reverb(sig, decay=0.45, mix_amt=0.30, damp=3400.0, seed=41)


def victory():
    d = 1.4
    notes = [(523.25, 0.00), (659.25, 0.22), (783.99, 0.44)]
    sig = np.zeros(n_of(d))
    for i, (f, st) in enumerate(notes):
        v = tone(f, 0.85, attack=0.006, decay=0.55, amp=0.85 - 0.08 * i,
                 partials=((1.0, 1.0), (2.0, 0.26), (3.0, 0.10), (4.0, 0.04)))
        sig += add_at(n_of(d), v, st)
    shine = bell(1046.5, 0.9, amp=0.22, partials=((1.0, 1.0), (2.0, 0.30), (3.0, 0.10)))
    sig += add_at(n_of(d), shine, 0.56)
    return reverb(sig, decay=0.75, mix_amt=0.32, damp=3800.0, seed=51)


def defeat():
    d = 1.6
    notes = [(392.00, 0.00), (329.63, 0.30), (261.63, 0.62)]
    sig = np.zeros(n_of(d))
    for i, (f, st) in enumerate(notes):
        v = tone(f, 0.9, attack=0.010, decay=0.60, amp=0.80 - 0.06 * i,
                 partials=((1.0, 1.0), (2.0, 0.20), (3.0, 0.06)))
        v = lowpass(v, 2800.0)
        sig += add_at(n_of(d), v, st)
    low = sine_f(sweep_freq(164.8, 131.0, n_of(d)), amp=0.14) * env_swell(n_of(d), 0.1, 1.0)
    sig += low
    return reverb(sig, decay=0.9, mix_amt=0.34, damp=2600.0, seed=61)


def hit_generic():
    d = 0.15
    knock = tone(880.0, d, attack=0.0005, decay=0.038, amp=0.9, partials=WOOD_PARTIALS)
    thump = sine_f(sweep_freq(230.0, 160.0, n_of(d)), amp=0.45) * env_ad(n_of(d), 0.001, 0.05)
    tsk = bandpass(noise(d, 71), 950.0, 4200.0) * env_ad(n_of(d), 0.0003, 0.028) * 0.75
    return lowpass(mix(knock, thump, tsk), 7000.0)


def hit_slash():
    d = 0.25
    cut = bandpass_sweep(noise(d, 81), 5200.0, 900.0, win=0.012, order=2, q=1.5)
    cut *= env_ad(n_of(d), 0.0025, 0.075)
    air = highpass(noise(d, 82), 3200.0) * env_ad(n_of(d), 0.0015, 0.045) * 0.35
    edge = sine_f(sweep_freq(2100.0, 620.0, n_of(d)), amp=0.30) * env_ad(n_of(d), 0.001, 0.05)
    return lowpass(mix(cut, air, edge), 8200.0)


def hit_heavy():
    d = 0.35
    sub = sine_f(sweep_freq(140.0, 82.0, n_of(d)), amp=0.85) * env_ad(n_of(d), 0.002, 0.16)
    body = lowpass(noise(d, 91), 900.0, order=2) * env_ad(n_of(d), 0.001, 0.09) * 0.7
    knock = tone(300.0, d, attack=0.001, decay=0.12, amp=0.45,
                 partials=((1.0, 1.0), (2.4, 0.22), (4.1, 0.08)))
    sig = mix(sub, body, knock)
    return reverb(lowpass(sig, 3000.0), decay=0.28, mix_amt=0.24, damp=2400.0, seed=92)


def explosion():
    d = 1.2
    blast = lowpass(noise(d, 101), 1750.0, order=2) * env_ad(n_of(d), 0.002, 0.32)
    papery = bandpass(noise(d, 102), 1600.0, 5000.0) * env_ad(n_of(d), 0.001, 0.05) * 0.55
    roll = sine_f(sweep_freq(135.0, 46.0, n_of(d), curve=1.6), amp=0.55) * env_ad(n_of(d), 0.004, 0.32)
    rumble = lowpass(noise(d, 103), 300.0, order=2) * env_ad(n_of(d), 0.01, 0.40) * 0.5
    sig = mix(blast, papery, roll, rumble)
    sig = reverb(sig, decay=0.6, mix_amt=0.34, damp=2200.0, seed=104)
    return lowpass(sig, 4200.0)


def bounce_wall():
    d = 0.12
    a = tone(520.0, d, attack=0.0006, decay=0.05, amp=1.0, partials=WOOD_PARTIALS)
    b = tone(890.0, d, attack=0.0005, decay=0.028, amp=0.35, partials=WOOD_PARTIALS)
    tk = bandpass(noise(d, 111), 1500.0, 5200.0) * env_ad(n_of(d), 0.0004, 0.012) * 0.45
    return lowpass(mix(a, b, tk), 6800.0)


def bounce_ball():
    """球撞球：比撞墙更饱满 —— 有音高感、有空腔共鸣、噪声成分少"""
    d = 0.18
    a = tone(392.0, d, attack=0.0008, decay=0.095, amp=1.0, partials=WOOD_PARTIALS)
    b = tone(588.0, d, attack=0.0008, decay=0.070, amp=0.55, partials=WOOD_PARTIALS)
    hollow_n = n_of(d)
    hollow = np.zeros(hollow_n)
    base = sine_f(sweep_freq(196.0, 176.0, hollow_n), amp=1.0) * env_ad(hollow_n, 0.001, 0.085)
    for k in range(1, 4):
        hollow += add_at(hollow_n, base * (0.55 ** k), 0.0045 * k)
    body = bandpass(noise(d, 121), 400.0, 1200.0) * env_ad(n_of(d), 0.0008, 0.030) * 0.32
    return lowpass(mix(a, b, hollow * 0.45, body), 5200.0)


def hurt():
    """受击：闷响 + 轻微不适感（中频带一点点"发闷的压痛"，不做成惨叫）"""
    d = 0.3
    thud = sine_f(sweep_freq(260.0, 140.0, n_of(d), curve=1.3), amp=0.9) * env_ad(n_of(d), 0.003, 0.12)
    muffle = lowpass(noise(d, 131), 520.0, order=2) * env_ad(n_of(d), 0.002, 0.10) * 0.8
    n = n_of(d)
    beat = (sine(302.0, d, amp=0.5) + sine(315.0, d, amp=0.5)) * env_ad(n, 0.02, 0.16) * 0.34
    sig = mix(thud, muffle, beat)
    return reverb(lowpass(sig, 3000.0), decay=0.25, mix_amt=0.20, damp=2000.0, seed=132)


def immune_block():
    d = 0.5
    ding = bell(1568.0, d, amp=0.75, partials=((1.0, 1.0), (2.0, 0.34), (3.02, 0.14), (4.8, 0.06)))
    ding2 = bell(2093.0, 0.4, amp=0.35, partials=((1.0, 1.0), (2.0, 0.28), (3.0, 0.10)))
    glass = bandpass(noise(d, 141), 3500.0, 8000.0) * env_ad(n_of(d), 0.001, 0.09) * 0.28
    seal = sine(1046.5, 0.35, amp=0.18) * env_ad(n_of(0.35), 0.004, 0.18)
    sig = mix(ding, add_at(n_of(d), ding2, 0.012), glass, seal)
    return reverb(lowpass(sig, 9000.0), decay=0.3, mix_amt=0.30, damp=5200.0, seed=142)


def black_flash():
    """黑闪：短促黑红冲击 -> 明亮上行能量涌起 -> 1.5s 余韵"""
    d = 2.5
    n = n_of(d)
    # 1) 冲击（0 ~ 0.10s）
    impact = lowpass(noise(0.16, 151), 900.0, order=2) * env_ad(n_of(0.16), 0.0005, 0.055)
    dark = sine_f(sweep_freq(120.0, 52.0, n_of(0.16), curve=1.4), amp=1.0) * env_ad(n_of(0.16), 0.001, 0.07)
    red = bandpass(noise(0.16, 152), 220.0, 620.0) * env_ad(n_of(0.16), 0.0008, 0.05) * 0.7
    # 2) 能量涌起（0.06 ~ 0.95s，上行 + 渐强）
    up_n = n_of(0.9)
    rise = (sine_f(sweep_freq(180.0, 880.0, up_n, curve=1.5), amp=0.85)
            + sine_f(sweep_freq(270.0, 1320.0, up_n, curve=1.5), amp=0.30)
            + sine_f(sweep_freq(90.0, 440.0, up_n, curve=1.5), amp=0.45))
    rise *= env_swell(up_n, 0.35, 0.25)
    swirl = bandpass_sweep(noise(0.9, 153), 320.0, 3200.0, win=0.03, q=1.6) * env_swell(up_n, 0.45, 0.2) * 0.55
    # 3) 余韵（0.75 ~ 2.5s）：明亮 pad + 长混响 + 仪式感低频
    tail_n = n_of(1.75)
    chord = np.zeros(tail_n)
    for f, a, ph in ((523.25, 0.85, 0.0), (659.25, 0.55, 1.1), (783.99, 0.45, 2.2), (1046.5, 0.30, 3.1)):
        chord += a * sine(f, 1.75, phase=ph)
    chord *= env_swell(tail_n, 0.05, 1.5) / 2.0
    shine = np.zeros(tail_n)
    for i, f in enumerate((1046.5, 1318.5, 1568.0, 2093.0)):
        b = bell(f, 1.3, amp=0.16 - 0.02 * i)
        shine += add_at(tail_n, b, 0.03 + 0.09 * i)
    ritual = sine(65.4, 1.75, amp=0.22) * env_swell(tail_n, 0.08, 1.3)
    sig = mix(add_at(n, impact, 0.0), add_at(n, dark, 0.0), add_at(n, red, 0.0),
              add_at(n, rise, 0.06), add_at(n, swirl, 0.06),
              add_at(n, chord, 0.72), add_at(n, shine, 0.72), add_at(n, ritual, 0.72))
    sig = reverb(sig, decay=1.0, mix_amt=0.36, damp=3400.0, predelay=0.02, seed=154)
    return lowpass(sig, 7000.0)


def cast_gojo1_blue():
    """苍：低沉缓慢的能量球成型，带吸引/漩涡感"""
    d = 0.9
    n = n_of(d)
    core = sine_f(sweep_freq(62.0, 148.0, n), amp=0.95) * env_swell(n, 0.42, 0.28)
    core += sine_f(sweep_freq(124.0, 296.0, n), amp=0.22) * env_swell(n, 0.5, 0.25)
    swirl = bandpass_sweep(noise(d, 161), 260.0, 900.0, win=0.03, q=1.8)
    swirl *= env_swell(n, 0.4, 0.3) * lfo(d, 5.5, depth=0.35, offset=0.65)
    vib = sine_f(sweep_freq(330.0, 780.0, n) * lfo(d, 4.2, depth=0.03, offset=1.0),
                 amp=0.26) * env_swell(n, 0.55, 0.25)
    sig = mix(core, swirl * 0.7, vib)
    return reverb(sig, decay=0.5, mix_amt=0.30, damp=2600.0, seed=162)


def cast_gojo1_red():
    """赫：极快的一记破空（暗红、短促）"""
    d = 0.35
    n = n_of(d)
    whoosh = bandpass_sweep(noise(d, 171), 420.0, 3800.0, win=0.010, q=1.8)
    whoosh *= env_ad(n, 0.0008, 0.055)
    edge = sine_f(sweep_freq(1500.0, 320.0, n), amp=0.42) * env_ad(n, 0.001, 0.07)
    punch = sine_f(sweep_freq(130.0, 70.0, n), amp=0.55) * env_ad(n, 0.001, 0.09)
    tail = bandpass(noise(d, 172), 1200.0, 4200.0) * env_ad(n, 0.006, 0.16) * 0.22
    return lowpass(mix(whoosh, edge, punch, tail), 8000.0)


def cast_murasaki():
    """茈：两层能量融合 + 巨大放大感"""
    d = 1.8
    n = n_of(d)
    blue = sine_f(sweep_freq(78.0, 126.0, n), amp=0.55) * env_swell(n, 0.55, 0.9)
    blue += sine_f(sweep_freq(156.0, 252.0, n), amp=0.20) * env_swell(n, 0.6, 0.9)
    red = sine_f(sweep_freq(430.0, 322.0, n), amp=0.40) * env_swell(n, 0.5, 0.9)
    red *= lfo(d, 7.0, depth=0.25, offset=0.75)
    fuse = bandpass_sweep(noise(d, 181), 260.0, 2600.0, win=0.04, q=1.6)
    fuse *= env_swell(n, 0.8, 0.85) * 0.55
    bloom_n = n_of(1.2)
    bloom = np.zeros(bloom_n)
    for f, a in ((110.0, 0.9), (165.0, 0.5), (220.0, 0.55), (330.0, 0.3), (440.0, 0.18)):
        bloom += a * sine(f, 1.2)
    bloom *= env_swell(bloom_n, 0.10, 1.0) / 1.35
    sig = mix(blue, red, fuse, add_at(n, bloom, 0.62))
    sig = reverb(sig, decay=0.85, mix_amt=0.36, damp=2800.0, seed=182)
    return lowpass(sig, 6200.0)


def cast_gojo2():
    """无下限术式：空间被隔开的气泡 / 绝对领域感"""
    d = 0.6
    n = n_of(d)
    hollow = np.zeros(n)
    base = sine_f(sweep_freq(196.0, 232.0, n), amp=1.0) * env_ad(n, 0.02, 0.30)
    for k in range(1, 6):
        hollow += add_at(n, base * (0.6 ** k), 0.0035 * k)
    hollow *= 0.5
    bubble = sine_f(sweep_freq(520.0, 700.0, n) * lfo(d, 9.0, depth=0.06, offset=1.0),
                    amp=0.22) * env_swell(n, 0.12, 0.35)
    seal = lowpass(noise(0.22, 191), 900.0, order=2) * env_ad(n_of(0.22), 0.004, 0.11) * 0.6
    drop = sine_f(sweep_freq(420.0, 170.0, n), amp=0.25) * env_ad(n, 0.01, 0.22)
    sig = mix(hollow, bubble, add_at(n, seal, 0.05), drop)
    return reverb(sig, decay=0.35, mix_amt=0.35, damp=3000.0, seed=192)


def cast_gojo3():
    """无量空处：领域展开，广阔空灵 + 信息涌入的泛音层"""
    d = 2.2
    n = n_of(d)
    # 缓慢展开的宽广和弦（泛音堆叠）
    pad_n = n_of(2.2)
    pad = np.zeros(pad_n)
    root = 130.81
    ratios = (1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0)
    for i, r in enumerate(ratios):
        f = root * r
        for det in (1.0, 1.0022, 0.9979):
            pad += (0.9 / (1 + i * 0.55)) * np.sin(2 * np.pi * f * det * t_of(pad_n) + i * 1.7)
    pad *= env_swell(pad_n, 0.85, 1.1) / 6.0
    # 信息涌入：密度递增的细小铃音
    info = np.zeros(n)
    rng = np.random.default_rng(201)
    scale = (523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66, 1396.91)
    t = 0.25
    step = 0.16
    while t < d - 0.25:
        f = float(rng.choice(scale))
        info += add_at(n, bell(f, 0.45, amp=0.085), t)
        t += step
        step = max(0.028, step * 0.985)
    shimmer = bandpass_sweep(noise(d, 202), 1200.0, 6000.0, win=0.05, q=1.8)
    shimmer *= env_swell(n, 1.0, 0.9) * 0.22
    sub = sine(65.4, d, amp=0.28) * env_swell(n, 0.7, 1.0)
    sig = mix(pad, info, shimmer, sub)
    sig = reverb(sig, decay=1.1, mix_amt=0.40, damp=4200.0, predelay=0.025, seed=203)
    return lowpass(sig, 8000.0)


def cast_sukuna1():
    """解：干净利落的一字斩"""
    d = 0.35
    n = n_of(d)
    cut = bandpass_sweep(noise(d, 211), 4600.0, 700.0, win=0.009, q=1.7)
    cut *= env_ad(n, 0.0006, 0.055)
    edge = sine_f(sweep_freq(2500.0, 880.0, n), amp=0.38) * env_ad(n, 0.0008, 0.045)
    air = bandpass(noise(d, 212), 250.0, 700.0) * env_ad(n, 0.002, 0.10) * 0.30
    return lowpass(mix(cut, edge, air), 8500.0)


def cast_sukuna1_grid():
    """捌：网格状多刀连斩（3~4 次快速切割叠加）"""
    d = 0.7
    n = n_of(d)
    sig = np.zeros(n)
    slashes = [(0.00, 4200.0, 700.0, 1.00), (0.085, 3600.0, 600.0, 0.88),
               (0.165, 4900.0, 820.0, 0.95), (0.245, 3000.0, 520.0, 0.78)]
    for i, (st, f0, f1, amp) in enumerate(slashes):
        seg = bandpass_sweep(noise(0.22, 221 + i), f0, f1, win=0.008, q=1.6)
        seg *= env_ad(n_of(0.22), 0.0005, 0.045) * amp
        sig += add_at(n, seg, st)
        edge = sine_f(sweep_freq(f0 * 0.7, f1 * 1.2, n_of(0.12)), amp=0.18 * amp)
        sig += add_at(n, edge * env_ad(n_of(0.12), 0.0008, 0.035), st)
    hum = (sine(92.0, 0.4, amp=0.5) + sine(138.0, 0.4, amp=0.3)) * env_ad(n_of(0.4), 0.06, 0.22)
    sig += add_at(n, hum * 0.35, 0.30)
    sig = reverb(sig, decay=0.35, mix_amt=0.26, damp=3000.0, seed=226)
    return lowpass(sig, 8500.0)


def cast_sukuna2():
    """灶·开：火焰弓拉弓 + 火箭射出"""
    d = 1.1
    n = n_of(d)
    # 拉弓（0 ~ 0.5s）
    draw = lowpass(noise(0.5, 231), 700.0, order=2) * env_swell(n_of(0.5), 0.35, 0.1) * 0.55
    creak = sine_f(sweep_freq(175.0, 330.0, n_of(0.5)) * lfo(0.5, 13.0, depth=0.02, offset=1.0),
                   amp=0.26) * env_swell(n_of(0.5), 0.3, 0.12)
    # 射出（0.5s 起）：火焰 + 上行火箭
    fire = lowpass(noise(0.6, 232), 1900.0, order=2) * env_ad(n_of(0.6), 0.002, 0.30)
    crack = crackle(0.6, 233, rate=140, lo=1500.0, hi=5200.0) * env_ad(n_of(0.6), 0.003, 0.22) * 0.45
    arrow = sine_f(sweep_freq(240.0, 1350.0, n_of(0.5), curve=0.85), amp=0.45) * env_ad(n_of(0.5), 0.004, 0.18)
    sig = mix(add_at(n, draw, 0.0), add_at(n, creak, 0.0),
              add_at(n, fire, 0.5), add_at(n, crack, 0.5), add_at(n, arrow, 0.5))
    sig = reverb(sig, decay=0.45, mix_amt=0.28, damp=3000.0, seed=234)
    return lowpass(sig, 6000.0)


def cast_sukuna3():
    """伏魔御厨子：领域展开（斩击 + 威压 + 持续低频脉动）"""
    d = 2.2
    n = n_of(d)
    sig = np.zeros(n)
    # 持续低频脉动（心跳般的威压，但不轰头）
    pulse_period = 0.28
    t = 0.05
    while t < d - 0.35:
        p = sine_f(sweep_freq(72.0, 52.0, n_of(0.3)), amp=0.5) * env_ad(n_of(0.3), 0.006, 0.13)
        sig += add_at(n, p, t)
        t += pulse_period
    # 暗色 pad
    pad = np.zeros(n)
    for f, a in ((110.0, 0.7), (130.81, 0.5), (164.81, 0.4), (220.0, 0.34)):
        pad += a * sine(f, d)
    pad *= env_swell(n, 0.5, 0.8) / 1.8
    # 连续斩击（密度递增）
    t = 0.35
    gap = 0.30
    i = 0
    while t < d - 0.30:
        f0 = 3800.0 + 900.0 * ((i % 3) - 1)
        seg = bandpass_sweep(noise(0.25, 241 + i), f0, 700.0, win=0.009, q=1.6)
        sig += add_at(n, seg * env_ad(n_of(0.25), 0.0006, 0.05) * 0.85, t)
        t += gap
        gap = max(0.12, gap * 0.88)
        i += 1
    # 低语般的持续噪声（威压感）
    mur = lowpass(noise(d, 259), 380.0, order=2) * env_swell(n, 0.6, 0.7)
    mur *= lfo(d, 1.6, depth=0.35, offset=0.65) * 0.35
    sig = mix(sig, pad, mur)
    sig = reverb(sig, decay=0.9, mix_amt=0.34, damp=2600.0, seed=260)
    return lowpass(sig, 5000.0)


def domain_tick():
    """伏魔御厨子单次自动斩击（每 0.1s 触发，必须很短很轻）"""
    d = 0.08
    n = n_of(d)
    cut = bandpass_sweep(noise(d, 271), 3400.0, 1200.0, win=0.007, q=1.6) * env_ad(n, 0.0004, 0.020)
    edge = sine_f(sweep_freq(1500.0, 900.0, n), amp=0.18) * env_ad(n, 0.0006, 0.016)
    return lowpass(mix(cut * 0.8, edge), 8000.0)


# ----------------------------------------------------------------------------
# BGM（25s 无缝循环：所有分频量化到循环网格 + 循环卷积处理，首尾严格相接）
# ----------------------------------------------------------------------------
BGM_LOOP = 25.0


def _bgm_common(x):
    """BGM 通用收尾：循环滤波（保持周期性）+ 轻混响（循环卷积）"""
    x = lowpass(x, 4200.0, order=2, circular=True)
    x = highpass(x, 45.0, order=2, circular=True)
    x = reverb(x, decay=0.9, mix_amt=0.30, damp=2600.0, predelay=0.02,
               seed=999, circular=True)
    x = lowpass(x, 5000.0, order=2, circular=True)
    return normalize(x, 1.0)


def bgm_menu():
    """菜单：极简柔和，慢速 pad 和弦 + 偶发单音"""
    n = n_of(BGM_LOOP)
    buf = np.zeros(n)
    # 4 个和弦，各 6.25s（Am - F - C - G）
    chords = [
        (0.00, (110.00, 261.63, 329.63, 440.00)),
        (6.25, (87.31, 220.00, 261.63, 349.23)),
        (12.50, (130.81, 261.63, 329.63, 392.00)),
        (18.75, (98.00, 246.94, 293.66, 392.00)),
    ]
    for i, (st, freqs) in enumerate(chords):
        note = pad_note(freqs, 8.5, BGM_LOOP, amp=0.62, attack=1.6, release=2.6, seed=300 + i)
        circ_add(buf, note, st)
    # 偶发单音（五声音阶铃音）
    singles = [(2.30, 880.00), (8.10, 659.25), (13.70, 1046.50), (19.40, 587.33), (22.60, 783.99)]
    for i, (st, f) in enumerate(singles):
        fq = q_freq(f, BGM_LOOP)
        note = bell(fq, 3.2, amp=0.16,
                    partials=((1.0, 1.0), (2.0, 0.26), (3.0, 0.10), (4.2, 0.05)))
        note = note * lfo(3.2, 0.4, depth=0.12, offset=0.88)
        circ_add(buf, note, st)
    # 极慢的整体呼吸（周期 12.5s，正好整除循环）
    buf *= lfo(BGM_LOOP, 2.0 / BGM_LOOP, depth=0.10, offset=0.90)
    return fit(_bgm_common(buf), BGM_LOOP)


def bgm_battle():
    """战斗：稍快、稳定轻脉冲，但不吵"""
    n = n_of(BGM_LOOP)
    buf = np.zeros(n)
    beat = BGM_LOOP / 40.0            # 96 BPM，恰好 40 拍
    bpm_root = (110.00, 87.31, 130.81, 98.00)   # Am F C G，每个 10 拍
    # pad（每 6.25s 换和弦）
    for i in range(4):
        freqs = [(110.00, 261.63, 329.63), (87.31, 220.00, 261.63),
                 (130.81, 261.63, 329.63), (98.00, 246.94, 293.66)][i]
        note = pad_note(freqs, 7.0, BGM_LOOP, amp=0.34, attack=0.9, release=1.8, seed=400 + i)
        circ_add(buf, note, i * 6.25)
    # 低音脉冲（每 2 拍一次）
    for k in range(20):
        root = bpm_root[(k * 2) // 10 % 4]
        fq = q_freq(root, BGM_LOOP)
        seg = (np.sin(2 * np.pi * fq * t_of(n_of(0.42)))
               + 0.25 * np.sin(2 * np.pi * q_freq(root * 2, BGM_LOOP) * t_of(n_of(0.42))))
        seg *= env_ad(n_of(0.42), 0.004, 0.30, floor=2e-3) * 0.34
        circ_add(buf, seg, k * 2 * beat)
    # 轻脉冲 tick（每拍，4 拍一重音）
    for k in range(40):
        accent = 1.0 if k % 4 == 0 else (0.6 if k % 2 == 0 else 0.42)
        seg = bandpass(noise(0.05, 500 + k), 1100.0, 3600.0) * env_ad(n_of(0.05), 0.0006, 0.016) * 0.16 * accent
        seg += tone(880.0, 0.05, attack=0.0008, decay=0.014, amp=0.055 * accent,
                    partials=((1.0, 1.0), (2.0, 0.2)))
        circ_add(buf, seg, k * beat)
    # 旋律拨奏（五声音阶，带休止）
    mel = [0, 3, 5, 8, 10, 13, 16, 18, 21, 24, 27, 30, 33, 36]
    scale = (440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50)
    for i, k in enumerate(mel):
        if i % 4 == 1:
            continue
        f = scale[(i * 3 + k) % len(scale)]
        fq = q_freq(f, BGM_LOOP)
        seg = (np.sin(2 * np.pi * fq * t_of(n_of(1.1)))
               + 0.22 * np.sin(2 * np.pi * q_freq(f * 2.0, BGM_LOOP) * t_of(n_of(1.1))))
        seg *= env_ad(n_of(1.1), 0.004, 0.55, floor=2e-3) * 0.16
        circ_add(buf, seg, k * beat)
    buf *= lfo(BGM_LOOP, 4.0 / BGM_LOOP, depth=0.07, offset=0.93)
    return fit(_bgm_common(buf), BGM_LOOP)


# ============================================================================
# 清单
# ============================================================================
SOUNDS = [
    ('ui_click.wav', ui_click, False),
    ('ui_hover.wav', ui_hover, False),
    ('countdown.wav', countdown, False),
    ('round_start.wav', round_start, False),
    ('victory.wav', victory, False),
    ('defeat.wav', defeat, False),
    ('hit_generic.wav', hit_generic, False),
    ('hit_slash.wav', hit_slash, False),
    ('hit_heavy.wav', hit_heavy, False),
    ('explosion.wav', explosion, False),
    ('bounce_wall.wav', bounce_wall, False),
    ('bounce_ball.wav', bounce_ball, False),
    ('hurt.wav', hurt, False),
    ('immune_block.wav', immune_block, False),
    ('black_flash.wav', black_flash, False),
    ('cast_gojo1_blue.wav', cast_gojo1_blue, False),
    ('cast_gojo1_red.wav', cast_gojo1_red, False),
    ('cast_murasaki.wav', cast_murasaki, False),
    ('cast_gojo2.wav', cast_gojo2, False),
    ('cast_gojo3.wav', cast_gojo3, False),
    ('cast_sukuna1.wav', cast_sukuna1, False),
    ('cast_sukuna1_grid.wav', cast_sukuna1_grid, False),
    ('cast_sukuna2.wav', cast_sukuna2, False),
    ('cast_sukuna3.wav', cast_sukuna3, False),
    ('domain_tick.wav', domain_tick, False),
    ('bgm_menu.wav', bgm_menu, True),
    ('bgm_battle.wav', bgm_battle, True),
]

# 噪声爆发类音效：尖峰孤立，做一次零相位削峰，让"身体"听得见（不影响峰值规格）
SHAVE = {'explosion.wav', 'hit_heavy.wav', 'hurt.wav', 'cast_sukuna2.wav', 'cast_gojo2.wav'}


def _fingerprint(a, sr, nband=12, nseg=8, win=1024, hop=256):
    """时频指纹：12 个对数频带 x 8 个时间段，log 压缩后去均值再归一化。
       同时反映频谱与包络形状，用来客观衡量"两个音效听起来像不像"。"""
    if len(a) < win:
        a = np.pad(a, (0, win - len(a)))
    nfr = 1 + (len(a) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(nfr)[:, None]
    S = np.abs(np.fft.rfft(a[idx] * np.hanning(win), axis=1)) ** 2
    f = np.fft.rfftfreq(win, 1.0 / sr)
    edges = 40.0 * (10000.0 / 40.0) ** (np.arange(nband + 1) / nband)
    band = np.zeros((nband, nfr))
    for i in range(nband):
        m = (f >= edges[i]) & (f < edges[i + 1])
        band[i] = S[:, m].mean(axis=1) if m.any() else 0.0
    tf = np.zeros((nband, nseg))
    for s in range(nseg):
        i0 = min(int(s * nfr / nseg), max(0, nfr - 1))
        i1 = min(max(i0 + 1, int((s + 1) * nfr / nseg)), nfr)
        tf[:, s] = band[:, i0:i1].mean(axis=1)
    v = np.log10(tf + 1e-10).ravel()
    v = np.nan_to_num(v, nan=-10.0, posinf=0.0, neginf=-10.0)
    v = v - v.mean()
    nn = np.linalg.norm(v)
    return v / nn if nn > 1e-9 else v


def _profile_bar(a, buckets=26):
    """把包络画成一行字符，肉眼确认"起-涨-尾"的形状"""
    chunks = np.array_split(a, buckets)
    rms = np.array([np.sqrt(np.mean(c ** 2)) if len(c) else 0.0 for c in chunks])
    m = rms.max() or 1.0
    chars = ' .:-=+*#%@'
    return ''.join(chars[min(len(chars) - 1, int(v / m * (len(chars) - 1) + 0.5))] for v in rms)


def analyze(paths, loops=()):
    """客观体检：亮度（频谱质心）、>8kHz 刺耳占比、<60Hz 轰头占比、有效响度、
       时频指纹相似度（越大越像）、包络形状"""
    names, feats, cents, highs, lows, rmss = [], [], [], [], [], []
    for p in paths:
        a, _, _, fr, nf = read_wav(p)
        if np.max(np.abs(a)) < 1e-9:
            continue
        X = np.abs(np.fft.rfft(a * np.hanning(len(a))))
        f = np.fft.rfftfreq(len(a), 1.0 / fr)
        e = X ** 2
        tot = e.sum() + 1e-18
        cent = float((f * e).sum() / tot)
        hi = float(e[f > 8000].sum() / tot)
        lo = float(e[f < 60].sum() / tot)
        rms_db = 20 * math.log10(float(np.sqrt(np.mean(a ** 2))) + 1e-12)
        names.append(os.path.basename(p))
        feats.append(_fingerprint(a, fr))
        cents.append(cent)
        highs.append(hi)
        lows.append(lo)
        rmss.append(rms_db)
        print('%-24s 质心%7.0fHz >8k%5.2f%% <60Hz%5.2f%% RMS%6.1fdB  %s' %
              (names[-1], cent, hi * 100, lo * 100, rms_db, _profile_bar(a)))
    F = np.array(feats)
    S = F @ F.T
    np.fill_diagonal(S, -9.0)
    pairs = [(S[i, j], names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names))]
    pairs.sort(reverse=True)
    print('\n时频指纹最相似的五对（1.0 = 完全一样，>0.97 基本听不出区别）：')
    for s, a_, b_ in pairs[:5]:
        print('  %.3f  %s  <->  %s' % (s, a_, b_))
    print('最不像的三对：')
    for s, a_, b_ in pairs[-3:]:
        print('  %.3f  %s  <->  %s' % (s, a_, b_))
    print('\n整体：平均质心 %.0f Hz，>8kHz 平均 %.2f%%（越低越不刺耳），'
          '<60Hz 平均 %.2f%%（越低越不轰头）' %
          (float(np.mean(cents)), float(np.mean(highs)) * 100, float(np.mean(lows)) * 100))
    print('响度：RMS %.1f ~ %.1f dB（峰值统一 -3dBFS，瞬态音效 RMS 天然更低；'
          '持续类音效可在 audio.js 里给一点负增益）' % (min(rmss), max(rmss)))



def main(argv):
    os.makedirs(OUT_DIR, exist_ok=True)
    only = None
    if '--only' in argv:
        i = argv.index('--only')
        only = set(a if a.endswith('.wav') else a + '.wav' for a in argv[i + 1:])
    print('输出目录：%s' % OUT_DIR)
    print('采样率 %d Hz / 16-bit PCM / 单声道\n' % SR)
    paths = []
    for name, fn, is_loop in SOUNDS:
        if only and name not in only:
            continue
        x = np.asarray(fn(), dtype=np.float64)
        path = save(name, x, loop=is_loop, shave_peaks=name in SHAVE)
        paths.append(path)
        print('  生成 %-24s %6.3fs' % (name, len(x) / SR))
    print()
    loops = set(n for n, _, l in SOUNDS if l)
    ok = verify(paths, loops)
    if '--analyze' in argv:
        print()
        analyze(paths, loops)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
