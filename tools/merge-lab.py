# -*- coding: utf-8 -*-
"""把 chart-lab.html 合并进 index.html（可重复执行）。

产出仍然是一个单 HTML：不需要 tools/lab-cells.js 这个外部脚本依赖。

用法：
    py tools/merge-lab.py            # 重新生成 index.html 里的三个标记块
    py tools/merge-lab.py --check    # 只比对，不写文件
"""
import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB = os.path.join(ROOT, 'chart-lab.html')
CELLS = os.path.join(ROOT, 'tools', 'lab-cells.js')
TARGET = os.path.join(ROOT, 'index.html')

MARK_CSS = ('/*<<<LAB_CSS>>>*/', '/*<<<END_LAB_CSS>>>*/')
MARK_HTML = ('<!--<<<LAB_HTML>>>-->', '<!--<<<END_LAB_HTML>>>-->')
MARK_CELLS = ('<!--<<<LAB_CELLS>>>-->', '<!--<<<END_LAB_CELLS>>>-->')
MARK_JS = ('<!--<<<LAB_JS>>>-->', '<!--<<<END_LAB_JS>>>-->')


# ---------------------------------------------------------------- 抽取
def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def between(s, a, b):
    i = s.find(a)
    if i < 0:
        raise SystemExit('找不到标记：' + a)
    i += len(a)
    j = s.find(b, i)
    if j < 0:
        raise SystemExit('找不到结束标记：' + b)
    return s[i:j]


def split_lab(src):
    css = between(src, '<style>', '</style>')
    body = between(src, '<body>', '<script src=')
    js = src[src.find('<script src='):]
    js = between(js, '</script>', '</script>')          # 落在「内联 script 的起止」之间
    js = re.sub(r'^\s*<script[^>]*>\s*', '', js)        # 剥掉残留的开标签
    js = re.sub(r'\s*</script>\s*$', '', js)
    if '<script' in js or '</script>' in js:
        raise SystemExit('lab 脚本里出现了额外的 script 标签，请检查')
    return css, body, js


# ---------------------------------------------------------------- CSS 作用域化
COMMENT = re.compile(r'/\*.*?\*/', re.S)


def clean_sel(buf):
    """去掉选择器前的注释，只留真正的 selector-list"""
    txt = COMMENT.sub(' ', buf)
    txt = txt.replace('\n', ' ').strip()
    txt = re.sub(r'\s+', ' ', txt)
    return txt


PCT = re.compile(r'^[\d.]+%$')


def prefix_part(p):
    p = p.strip()
    if not p:
        return ''
    if p.startswith('@') or PCT.match(p):
        return p                      # @media / @keyframes 前导 & 关键帧百分比
    if p == 'html':
        return ''                     # 页面高度由宿主 index.html 决定
    if p in ('body', ':root'):
        return '#lab-root'
    if p == '*':
        return '#lab-root *'
    if p.startswith('#lab-root'):
        return p
    return '#lab-root ' + p


def prefix_sel(sel):
    parts = [prefix_part(x) for x in sel.split(',')]
    parts = [x for x in parts if x]
    return ', '.join(parts) if parts else '#lab-root'


def scope_css(css):
    res = []
    buf = ''
    depth = 0
    for ch in css:
        if ch == '{':
            sel = clean_sel(buf)
            buf = ''
            res.append((prefix_sel(sel) if sel else '#lab-root') + '{')
            depth += 1
        elif ch == '}':
            depth -= 1
            res.append('}')
            buf = ''
        else:
            if depth == 0:
                buf += ch
            else:
                res.append(ch)
    if buf.strip():
        res.append(buf)
    return ''.join(res)


# 手工补的顶部/宿主规则，放在最后以覆盖同优先级的旧规则
CSS_TAIL = """
/* ---- 宿主整机内的呈现：整屏覆盖层，默认隐藏 ---- */
#lab-root{position:fixed;inset:0;z-index:9999;overflow:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;display:none}
body.lab-open #lab-root{display:flex}
body.lab-open #app,body.lab-open #rotate{visibility:hidden}
#lab-root header{gap:14px}
.lab-back{position:sticky;top:0;z-index:9;margin-left:auto;flex:0 0 auto;
  padding:6px 11px!important;border-color:rgba(242,179,61,.55)!important;
  background:rgba(242,179,61,.10)!important}
"""


# ---------------------------------------------------------------- id 改名
def collect_ids(*texts):
    ids = set()
    for t in texts:
        for m in re.finditer(r'\sid=(["\'])([A-Za-z][\w-]*)\1', t):
            ids.add(m.group(2))
    return sorted(ids, key=len, reverse=True)


def rename_ids(css, html, js, ids):
    """id X -> lab-X，顺手把 getElementById 换成作用域内的 querySelector"""
    def sub(text, is_js):
        for x in ids:
            text = re.sub(r'\sid=(["\'])%s\1' % re.escape(x), r' id="lab-%s"' % x, text)
            text = re.sub(r'\sfor=(["\'])%s\1' % re.escape(x), r' for="lab-%s"' % x, text)
            text = re.sub(r'aria-(?:controls|labelledby|describedby)=(["\'])%s\1' % re.escape(x),
                          lambda m: m.group(0).replace(m.group(2), 'lab-' + x), text)
            if is_js:
                text = re.sub(r"getElementById\((['\"])%s\1\)" % re.escape(x),
                              r"LR.querySelector('#lab-%s')" % x, text)
            # 选择器里的 #id：$('#map')、'#map .x'、CSS 的 "#pbar:hover"
            text = re.sub(r"(?<![\w#-])#%s\b" % re.escape(x), "#lab-%s" % x, text)
        return text

    css = sub(css, False)
    js = sub(js, False)      # JS 里的 '#id' 选择器也一起改
    js = sub(js, True)
    return css, sub(html, False), js


# ---------------------------------------------------------------- JS 作用域化
def scope_js(js):
    """IIFE -> 具名函数（延迟到点开编辑台时才执行）；DOM 查询收回 #lab-root 内"""
    head = "(function () {\n'use strict';"
    if head not in js:
        raise SystemExit('chart-lab 的脚本头变了，请检查：' + js[:60].replace('\n', '|'))
    js = js.replace(head, "function chartLabMain() {\n'use strict';\n"
                          "/* 宿主作用域：所有查询都限制在 #lab-root 内，避免碰到游戏的同名元素 */\n"
                          "const LR = document.getElementById('lab-root');\n"
                          "const LAB_OPEN = function(){return document.body.classList.contains('lab-open');};", 1)

    # IIFE 收尾 -> 函数收尾
    tail = "\nboot();\n})();"
    if tail not in js:
        raise SystemExit('chart-lab 的脚本尾变了')
    js = js.replace(tail, "\nboot();\n}", 1)

    # DOM 查询收进 LR（getElementById 已在 rename_ids 里处理）
    js = js.replace('document.querySelectorAll(', 'LR.querySelectorAll(')
    js = js.replace('document.querySelector(', 'LR.querySelector(')
    # 动态浮层（say 提示、复制用的 textarea）也放进宿主容器内，
    # 否则 $() 查不到、每次提示都会新建一个 div
    js = js.replace('document.body.appendChild(', 'LR.appendChild(')
    js = js.replace('document.body.removeChild(', 'LR.removeChild(')

    # 只在编辑台打开时才响应的全局监听
    js = js.replace("document.addEventListener('keydown', e => {\n",
                    "document.addEventListener('keydown', e => {\n  if (!LAB_OPEN()) return;\n", 1)
    js = js.replace("window.addEventListener('resize', () => { layout(); drawRoll(); drawMap(); drawPreview(); });",
                    "window.addEventListener('resize', () => { if (!LAB_OPEN()) return;\n"
                    "  layout(); drawRoll(); drawMap(); drawPreview(); });", 1)
    return js


def wrap_html(body):
    inner = body.strip('\n')
    back = ('<button type="button" class="chip lab-back" id="lab-back" '
            'title="返回游戏" aria-label="返回游戏">← 返回</button>')
    if '</header>' not in inner:
        raise SystemExit('chart-lab 顶栏结构变了，找不到 </header>')
    inner = re.sub(r'</header>', back + '\n</header>', inner, count=1)   # 顶栏右侧「返回游戏」
    inner = re.sub(r'^\s*本页需要 <code>tools/lab-cells\.js</code>[^\n]*\n\s*<code>NODE_PATH[^\n]*$',
                   '  谱面数据缺失：在仓库根目录执行 <code>py tools/merge-lab.py</code> 重新合并编辑台。',
                   inner, flags=re.M)
    return '<div id="lab-root" aria-label="谱面实验室">\n%s\n</div>' % inner


# ---------------------------------------------------------------- 写回
def replace_block(html, mark, body):
    """把 mark 之间的内容整体换成 body（mark 本身保留一份）"""
    a, b = mark
    if a in html:
        i = html.find(a)
        j = html.find(b, i)
        if j < 0:
            raise SystemExit('块未闭合：' + a)
        return html[:i] + a + '\n' + body + '\n' + html[j:]
    return None


def insert_block(html, needle, block, before=True):
    i = html.find(needle)
    if i < 0:
        raise SystemExit('找不到插入锚点：' + needle[:40])
    return html[:i] + block + '\n' + html[i:] if before else html[:i + len(needle)] + '\n' + block + html[i + len(needle):]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    src = read(LAB)
    css, html_part, js = split_lab(src)
    cells = read(CELLS).strip()

    ids = collect_ids(html_part, js)
    css, html_part, js = rename_ids(css, html_part, js, ids)

    css_out = scope_css(css) + CSS_TAIL
    html_out = wrap_html(html_part)
    js_out = scope_js(js)
    target = read(TARGET)
    css_payload = css_out
    html_payload = html_out
    cells_payload = '<script>\n' + cells + '\n</script>'
    js_payload = '<script>\n' + js_out + '\n</script>'

    # 逐块处理：块在就替换，块丢了就按自己的锚点补回来（主机文件可能被别的工具/编辑器动过）
    block = [
        (MARK_CSS, css_payload, '</style>'),
        (MARK_HTML, html_payload, '\n<script>\n(function(){'),
        (MARK_CELLS, cells_payload, None),
        (MARK_JS, js_payload, None),
    ]
    for idx, (mark, payload, anchor) in enumerate(block):
        got = replace_block(target, mark, payload)
        if got is not None:
            target = got
            continue
        body = mark[0] + '\n' + payload + '\n' + mark[1]
        if anchor:
            target = insert_block(target, anchor, body + '\n', before=True)
        else:
            pos = target.rfind('</script>') + len('</script>')
            target = target[:pos] + '\n\n' + body + target[pos:]
        print('  · 补回缺失的块：' + mark[0])

    if args.check:
        cur = read(TARGET)
        print('一致' if cur == target else '需要重新生成')
        return
    if read(TARGET) == target:
        print('无变化')
        return
    with io.open(TARGET, 'w', encoding='utf-8', newline='\n') as f:
        f.write(target)
    print('已合并：css %.1fKB html %.1fKB js %.1fKB cells %.1fKB  id 改名 %d 个'
          % (len(css_out) / 1024, len(html_out) / 1024, len(js_out) / 1024,
             len(cells) / 1024, len(ids)))
    print('  index.html -> %.2f MB' % (os.path.getsize(TARGET) / 1e6))


if __name__ == '__main__':
    main()
