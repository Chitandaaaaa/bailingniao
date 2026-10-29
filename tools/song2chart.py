# -*- coding: utf-8 -*-
"""从音频提取「弹奏点」，生成百灵鸟 rhythm-game 可用的曲目数据。

产出三样东西（写成 JSON，交给 inject_song.py 注入 index.html）：
  1. onsets   —— onset 列表 [{t(秒), pitch(MIDI), s(力度 0..1)}]
  2. timeline —— {musicLen, chartEnd, beat, bar, tailLen}
  3. meta     —— {title, artist, duration}

方法：短时傅里叶 → 对数谱通量(spectral flux) → 自适应阈值峰值挑选；
      每个 onset 单独取一段高分辨率窗做 HPS 谐波积谱，估算基频。
"""
import argparse, json, os, subprocess, sys
import numpy as np

SR = 22050                 # 分析用采样率（省内存）
WIN, HOP = 1024, 256       # 46ms 窗 / 11.6ms 跳距
FFT_P, FFT_H = 8192, 4096  # 音高分析窗 / 半重叠


# ---------------------------------------------------------------- 基础工具
def ffmpeg(exe=None):
    try:
        import imageio_ffmpeg
        return exe or imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return exe or 'ffmpeg'


def read_mono(path, sr=SR, trim_db=None):
    """ffmpeg 解码为单声道 float32 数组。"""
    cmd = [ffmpeg(), '-v', 'quiet', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, stdout=subprocess.PIPE, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    if trim_db is not None:
        thr = 10 ** (trim_db / 20.0)
        idx = np.flatnonzero(np.abs(x) > thr)
        if idx.size:
            x = x[idx[0]:idx[-1] + 1]
    return x


def stft_mag(x, win=WIN, hop=HOP):
    """返回归一化幅度谱 (frames, win//2+1)。"""
    n = (len(x) - win) // hop + 1
    if n <= 0:
        return np.zeros((0, win // 2 + 1))
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(win)[None, :]
    return np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)


# ---------------------------------------------------------------- onset 检测
def novelty_curve(mag):
    """对数压缩后的正向频谱通量。Mag -> 一维 novelty。"""
    M = np.log1p(60.0 * mag)
    d = np.diff(M, axis=0)
    nov = np.maximum(0.0, d).sum(axis=1)
    nov = np.concatenate([[0.0], nov])
    if nov.max() > 0:
        nov /= nov.max()
    return nov


def pick_peaks(nov, fps, min_gap=0.075, sens=1.25, win_sec=0.30, top_ratio=None):
    """自适应阈值局部最大值挑选。返回索引数组（按时间升序）。"""
    w = max(1, int(win_sec * fps))
    k = np.ones(2 * w + 1) / (2 * w + 1)
    pad = np.pad(nov, w, mode='edge')
    base = np.convolve(pad, k, mode='same')[w:-w]
    thr = base * sens + 0.010

    n = len(nov)
    cand = np.flatnonzero((nov > thr) & (nov >= np.r_[nov[:1], nov[:-1]]) & (nov > np.r_[nov[1:], nov[-1:]]))
    order = cand[np.argsort(-nov[cand])]

    step = max(1, int(min_gap * fps))
    keep = []
    taken = np.zeros(n, dtype=bool)
    for i in order:
        lo, hi = max(0, i - step), min(n, i + step + 1)
        if taken[lo:hi].any():
            continue
        taken[lo:hi] = True
        keep.append(i)
    keep.sort()
    if top_ratio is not None:
        strengths = np.sort(nov[keep])[::-1]
        cut = strengths[min(len(strengths) - 1, int(len(strengths) * top_ratio) - 1)]
        keep = [i for i in keep if nov[i] >= cut]
    return np.array(keep, dtype=int)


def hps_pitch(x, center, sr=SR, fmin=45.0, fmax=1400.0, harmonics=4):
    """在 center 处取 FFT_P 点窗做谐波积谱，估计基频(Hz)与置信度。"""
    half = FFT_P // 2
    s = int(center) - half
    if s < 0 or s + FFT_P > len(x):
        return None, 0.0
    seg = x[s:s + FFT_P] * np.hanning(FFT_P)
    spec = np.abs(np.fft.rfft(seg))
    freqs = np.fft.rfftfreq(FFT_P, 1.0 / sr)
    lo = int(np.searchsorted(freqs, fmin))
    hi = int(np.searchsorted(freqs, fmax))

    hps = spec[lo:hi].astype(np.float64).copy()
    for h in range(2, harmonics + 1):
        idx = np.minimum((np.arange(lo, hi) * h), len(spec) - 1)
        hps *= spec[idx]
    if hps.max() <= 0:
        return None, 0.0
    k = int(np.argmax(hps))
    f = freqs[lo + k]
    conf = min(1.0, spec[lo + k] / (spec.max() + 1e-9))
    return f, conf


def midi_of(f):
    return 69 + 12 * np.log2(f / 440.0)


def estimate_bpm(nov, fps, lo_bpm=48, hi_bpm=190, harmonics_weight=True):
    """对 novelty 做自相关，取最可能的四分音符 BPM。"""
    nov = nov - nov.mean()
    lags = np.arange(int(60.0 / hi_bpm * fps), int(60.0 / lo_bpm * fps))
    if len(lags) < 2:
        return 100.0
    ac = np.array([np.dot(nov[:len(nov) - L], nov[L:]) / (len(nov) - L) for L in lags])
    ac = np.maximum(ac, 0)
    # 偏向 "常见速度"：给 60-120 BPM 区间的候选加权，抑制倍频/分频误判
    bpm = 60.0 * fps / lags
    weight = np.ones_like(bpm)
    if harmonics_weight:
        weight *= np.exp(-((np.log2(bpm / 92.0)) ** 2) / 0.55)
    score = ac * weight
    return float(bpm[int(np.argmax(score))])


# ---------------------------------------------------------------- 主流程
def analyze(path, args):
    print('[1/4] 解码 PCM …')
    x = read_mono(path, trim_db=args.trim_db)
    dur = len(x) / SR
    print('      时长 %.2fs (%d 样本)' % (dur, len(x)))

    print('[2/4] 计算频谱通量 …')
    mag = stft_mag(x)
    fps = SR / HOP
    nov = novelty_curve(mag)
    print('      frames=%d fps=%.1f' % (len(nov), fps))

    print('[3/4] 峰值挑选 + 音高估计 …')
    idx = pick_peaks(nov, fps, min_gap=args.min_gap, sens=args.sens)
    print('      候选 onset %d 个 (%.2f/s)' % (len(idx), len(idx) / dur))

    bpm = args.bpm or estimate_bpm(nov, fps)
    print('      估计 BPM %.1f -> 节拍 %.3fs' % (bpm, 60.0 / bpm))

    onset_t = idx / fps
    strengths = nov[idx]
    smax = strengths.max() if strengths.size else 1.0
    smin = strengths.min() if strengths.size else 0.0
    rng = max(1e-9, smax - smin)

    onsets = []
    for i, t in enumerate(onset_t):
        f, conf = hps_pitch(x, int(t * SR))
        if f is None:
            pitch = 60.0
        else:
            pitch = float(np.clip(midi_of(f), 21, 108))
        u = (strengths[i] - smin) / rng
        # 目标量级：与 Summer 合成事件里的 g 对齐；>0.34 的会被判成 accent，
        # 0.33 的上限让最强的约 12% 成为重音，正好接近 design token 里的比例
        s = 0.050 + 0.330 * (u ** 0.7)
        onsets.append({'t': round(float(t), 3), 'p': pitch, 's': round(float(s), 4)})

    # 按 spec § musicOnsets 的口径合并成 cell（同 55ms 内的音算一个）
    cells = []
    for o in onsets:
        if cells and o['t'] - cells[-1]['t'] <= 0.055:
            c = cells[-1]
            c['s'] = round(c['s'] + o['s'], 4)
            if o['p'] > c['p']:
                c['p'] = o['p']
        else:
            cells.append(o)
    print('      合并后 cell %d 个' % len(cells))

    # 时间轴必须与最终播放的那份音频完全一致 —— 所以不做首尾裁剪，
    # musicLen 直接取整曲时长，和 Summer 里 MUSIC_LEN=3:36 的口径一致。
    tail = args.tail
    music_len = float(np.floor(dur * 100) / 100)
    if args.end_sec:
        music_len = float(args.end_sec)
    timeline = {
        'musicLen': round(music_len, 2),
        'chartEnd': round(music_len - tail, 2),
        'beat': round(60.0 / bpm, 4),
        'bar': round(240.0 / bpm, 4),
        'tailLen': tail,
    }
    print('      timeline=%s' % timeline)
    return {'onsets': cells, 'timeline': timeline,
            'meta': {'duration': round(music_len, 2), 'bpm': round(bpm, 1)}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('audio')
    ap.add_argument('-o', '--out', default='_tmp/song-data.json')
    ap.add_argument('--bpm', type=float, default=0)
    ap.add_argument('--min-gap', type=float, default=0.075)
    ap.add_argument('--sens', type=float, default=1.25)
    ap.add_argument('--trim-db', type=float, default=None)
    ap.add_argument('--tail', type=float, default=1.5)
    ap.add_argument('--end-sec', type=float, default=0)
    a = ap.parse_args()

    res = analyze(a.audio, a)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False)
    print('[4/4] 写出 ->', a.out)


if __name__ == '__main__':
    main()
