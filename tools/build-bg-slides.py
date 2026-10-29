# -*- coding: utf-8 -*-
"""把一组背景图压成体积可控的 jpg，内联进 index.html 做曲目轮播背景。

    py tools/build-bg-slides.py -i "A.jpg" "B.jpg" ... --prefix summer
    py tools/build-bg-slides.py -i "01.jpg" ... "07.jpg" --prefix kaze --quality 84

流程：裁掉顶部播放器 OSD → 等比缩到 --width → JPEG q--quality → 落一份压缩版到
assets/<prefix>-NN.jpg（入库，方便以后重跑）→ base64 注入 index.html 里
/*<<<BG_<PREFIX_UPPER>>>*/ 标记块，规则形如
`#scene-bg .set-<prefix> .bg-slide:nth-of-type(N){background-image:url(...)}`。

标记块里的 CSS 完全由本脚本生成，不要手工编辑；想改淡入时长/取景位置去改
标记块之外的 .bg-slide 规则。
"""
import argparse, base64, io, os, re, sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    raise SystemExit('缺少依赖：py -m pip install Pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'index.html')


def human(n):
    return '%.1f KB' % (n / 1024.0)


def process(src, width, quality, crop_top):
    im = Image.open(src).convert('RGB')
    if crop_top:
        im = im.crop((0, crop_top, im.width, im.height))
    if im.width > width:
        im = im.resize((width, int(round(im.height * width / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return im, buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-i', '--input', nargs='+', required=True, help='源图，按轮播顺序')
    ap.add_argument('--prefix', default='summer', help='资源名前缀与 CSS 类名前缀')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--quality', type=int, default=72)
    ap.add_argument('--crop-top', type=int, default=24, help='裁掉顶部 N 像素（播放器 OSD）')
    ap.add_argument('--html', default=HTML)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if len(args.input) > 9:
        raise SystemExit('最多 9 张（.bg-slide 的 nth-of-type 只排到 9）')

    tag = args.prefix.upper()
    BEGIN = '/*<<<BG_%s>>>*/' % tag
    END = '/*<<<END_BG_%s>>>*/' % tag

    rules, total_raw, total_b64 = [], 0, 0
    for i, src in enumerate(args.input, 1):
        im, data = process(src, args.width, args.quality, args.crop_top)
        b64 = base64.b64encode(data).decode('ascii')
        total_raw += len(data)
        total_b64 += len(b64)
        out = os.path.join(ROOT, 'assets', '%s-%02d.jpg' % (args.prefix, i))
        if not args.dry_run:
            with open(out, 'wb') as f:
                f.write(data)
        rules.append('#scene-bg .set-%s .bg-slide:nth-of-type(%d){background-image:url(data:image/jpeg;base64,%s)}'
                     % (args.prefix, i, b64))
        print('  %d/%d  %s  %dx%d  %s' % (i, len(args.input), os.path.basename(src),
                                          im.width, im.height, human(len(data))))

    print('合计：原图 %s → base64 %s' % (human(total_raw), human(total_b64)))
    if args.dry_run:
        return

    block = (BEGIN + '\n'
             + '/* 由 tools/build-bg-slides.py 生成：%d 张，宽 %d，q%d，裁顶 %dpx。勿手工编辑。 */\n' %
             (len(args.input), args.width, args.quality, args.crop_top)
             + '\n'.join(rules) + '\n'
             + END)

    with open(args.html, 'r', encoding='utf-8') as f:
        html = f.read()
    pat = re.compile(re.escape(BEGIN) + r'.*?' + re.escape(END), re.S)
    if not pat.search(html):
        raise SystemExit('index.html 里找不到标记块 %s … %s' % (BEGIN, END))
    html = pat.sub(lambda m: block, html, count=1)
    with open(args.html, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    print('已写入 %s（%.2f MB）' % (args.html, os.path.getsize(args.html) / 1048576))


if __name__ == '__main__':
    main()
