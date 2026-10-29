# -*- coding: utf-8 -*-
"""一键把一首新歌装进 index.html（保持单文件）。

流程：ncm 解密 → 重编码为体积可控的 mp3 → 直接分析这份成品 → base64 注入标记块。
关键点是「分析的对象就是最终嵌入的那份 mp3」，这样分析时钟与播放时钟天然同源，
不会因为转码引入几十毫秒的系统偏移。

    py tools/build-song.py -i "E:/.../久石譲 - 風のとおり道.ncm"

可选参数：
    --bitrate 128k  成品码率（想要更好音质就调高，文件会等比变大）
    --name KAZE     注入对象名（对应 index.html 里的 /*<<<SONG_XXX>>>*/ 标记）
    --keep          保留中间产物于 _tmp/
"""
import argparse, base64, json, os, re, shutil, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from ncm2audio import decrypt as ncm_decrypt
    from song2chart import analyze, ffmpeg
except ImportError:  # pragma: no cover
    raise SystemExit('缺少依赖：py -m pip install imageio-ffmpeg numpy pycryptodome')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(ROOT, '_tmp')


def human(n):
    return '%.2f MB' % (n / 1048576)


def encode(src, dst, bitrate):
    """重编码。保持 44.1kHz；原曲通常是立体声，降采样到单声道省一半体积，
    但这首有明显声场铺陈，所以默认留双声道。"""
    cmd = [ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
           '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', bitrate,
           '-ar', '44100', dst]
    subprocess.run(cmd, check=True)
    return dst


def compact_onsets(onsets):
    """-> '毫秒,音高,力度0-99'，用 ; 分隔。"""
    parts = []
    for o in onsets:
        parts.append('%d,%s,%d' % (int(round(o['t'] * 1000)),
                                   ('%.1f' % o['p']).rstrip('0').rstrip('.'),
                                   max(0, min(99, int(round(o['s'] * 100))))))
    return ';'.join(parts)


def inject(html, name, block):
    begin = '/*<<<SONG_%s>>>*/' % name
    end = '/*<<<END_SONG_%s>>>*/' % name
    i = html.find(begin)
    if i < 0:
        raise SystemExit('index.html 里找不到标记 ' + begin)
    j = html.find(end, i)
    if j < 0:
        raise SystemExit('index.html 里找不到结束标记 ' + end)
    return html[:i] + begin + '\n' + block + '\n' + html[j:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-i', '--input', required=True)
    ap.add_argument('--name', default='KAZE')
    ap.add_argument('--bitrate', default='160k')
    ap.add_argument('--mono', action='store_true')
    ap.add_argument('--html', default=os.path.join(ROOT, 'index.html'))
    ap.add_argument('--keep', action='store_true')
    a = ap.parse_args()

    os.makedirs(TMP, exist_ok=True)
    base = os.path.splitext(os.path.basename(a.input))[0]

    print('[1/5] 解密 NCM …')
    _, raw, _ = ncm_decrypt(a.input, os.path.join(TMP, base + '.src'))
    print('       原始音频 %s (%s)' % (human(os.path.getsize(raw)), os.path.basename(raw)))

    print('[2/5] 重编码 -> %s …' % a.bitrate)
    song = os.path.join(TMP, base + '.embed.mp3')
    encode(raw, song, a.bitrate)
    size = os.path.getsize(song)
    print('       成品 %s (base64 后 %s)' % (human(size), human(size * 1.34)))

    print('[3/5] 分析成品（确保分析时钟 == 播放时钟）…')
    res = analyze(song, argparse.Namespace(min_gap=0.075, sens=1.25, bpm=0,
                                           trim_db=None, end_sec=0, tail=1.5))
    on = compact_onsets(res['onsets'])
    T = res['timeline']
    print('       弹奏点 %d 个，payload %.1f KB' % (len(res['onsets']), len(on) / 1024))

    print('[4/5] base64 编码 …')
    b64 = base64.b64encode(open(song, 'rb').read()).decode('ascii')

    print('[5/5] 注入 index.html …')
    html = open(a.html, encoding='utf-8').read()
    block = (
        "const %s={\n"
        "  timeline:{musicLen:%s,chartEnd:%s,tail:%s,beat:%s,bar:%s},\n"
        "  /* %d 个弹奏点：毫秒,音高(MIDI),力度(0-99) */\n"
        "  onsets:'%s',\n"
        "  audio:'%s'\n"
        "};" % (a.name, T['musicLen'], T['chartEnd'], T['tailLen'], T['beat'], T['bar'],
                len(res['onsets']), on, b64)
    )
    open(a.html, 'w', encoding='utf-8').write(inject(html, a.name, block))

    print('       完成。index.html 现为 %s' % human(os.path.getsize(a.html)))
    if not a.keep:
        try:
            shutil.rmtree(TMP)
        except OSError:
            pass


if __name__ == '__main__':
    main()
