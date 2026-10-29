# 百灵鸟在五线谱上飞行 · Five Lines, One Flight

一个**单文件 HTML** 的下落式音乐节奏游戏：音符顺着五线谱的五条轨道落下，在判定线上被敲成鸟鸣与琴音。
整个游戏就是仓库根目录的 `index.html`（约 3.3 MB）——样式、脚本、背景插画、音频全部内联，
**无构建、无依赖、无网络请求**，直接双击即可运行。

---

## 快速开始

```bash
# 方式一：直接打开
start index.html          # Windows
open index.html           # macOS

# 方式二：本地服务器（推荐，避免个别浏览器对 file:// 的音频策略差异）
py -m http.server 8000    # 然后访问 http://localhost:8000/index.html
```

要求：现代浏览器（Chrome / Edge / Safari / Firefox 近几年版本），首次点击页面后 WebAudio 才能出声，**建议戴耳机**。

---

## 玩法

| 难度 | 轨道 | 键位 | PERFECT / GOOD 判定窗 |
|---|---|---|---|
| 练习 | 1 | `Space` | 75 / 170 ms |
| 简单 | 2 | `F` `J` | 75 / 170 ms |
| 困难 | 4 | `D` `F` `J` `K` | 58 / 135 ms |
| 噩梦 | 8 | `A` `S` `D` `F` `J` `K` `L` `;` | 48 / 112 ms |

- **判定**：PERFECT 100 分 / GOOD 50 分 / MISS 断连击。落点垫、反馈文字、里程碑特效都在判定线下方，不遮挡下落通道。
- **长按（hold）**：`keyup` 才解锁，同轨最小重触发间隔 90 ms，**空击不判 MISS、不扣分、不断连击**。
- **热身模式**：结算拿到 C / D 后出现，速度更慢、判定更宽松、前 15 秒不记分也不清连击，且不进结算面板——它是辅助模式，不是难度档。
- **教学**：首次进入有 3 秒倒计时与教学轨，之后缩短为 1.5 秒（记录在 localStorage）。
- **里程碑**：10 / 30 / 50 / 100 连击触发震屏与火舌，100 连击在判定线下方出一圈金色光环。
- **结算**：按准确率评 S / A / B / C / D（S 还需最大连击 ≥ 50 且 MISS ≤ 5%）。最高分**按曲目分开**记录。
- **设置**（标题页右下角齿轮）：色盲友好配色、宽松判定窗、落点预判高光、音画偏移（毫秒）、降低动效。
- **移动端**：横屏自适应，竖屏会提示旋转屏幕；触控走 `pointerdown`，判定线上方有 40 px 感应带。

---

## 曲目

曲目注册表是 `index.html` 里的 `SONGS` 数组，每首歌自带时间轴（`musicLen` / `chartEnd` / `tail` / `beat` / `bar`）和专属场景背景（`bgClass`）：

| id | 曲目 | 音源 | 时长 | 背景 |
|---|---|---|---|---|
| `summer` | Summer（菊次郎的夏天）· 久石让 | `synth`：WebAudio 程序化钢琴，弹奏点来自内联 MIDI 音符表 `SUMMER_RAW` | 3:36 | 6 张吉卜力风夏日田园，36s 一轮 |
| `kaze` | 風のとおり道（风之通道）· 久石让 | `audio`：base64 内嵌录音，弹奏点来自离线 onset 分析 | 3:17 | 7 张《龙猫》夜景，42s 一轮 |

---

## 架构要点

### 谱面是从音乐派生的，不是手写的

```
Sound.events → musicOnsets()   把 55 ms 内的音并成一个 cell
              → activityOf()    ±2.4 s 滑窗算活跃度
              → chartFromMusic() 八分槽择优 + 活跃度跳槽，按难度选轨
              → injectHolds()   抽一部分音符做成长按
```

**加一首新歌 = 给一张 onset 表**，其余全部复用。内联的 `ChartGen`（`/*<<<CHARTGEN>>>*/` 块）只是音乐未就位时的占位谱面，不是正式谱源。

### 轨道数也属于难度

坐标系不再是恒定的 5 轨。切难度必须走 `applyLanes(D)`：它重算 `LANE_X / HEX / LABEL / PAD_W / FB_X / FB_Y`，重建唱名与键位图例、SVG 谱线、精灵，并清空 `LANE_CACHE.key`。
每轨状态数组统一用 `fillArr()` 生成长度 `MAX_LANES = 8` 的数组，循环只走前 `LANE_N` 个。

### 切歌必须走 prepareSong()

时间基准 `BEAT / BAR / MUSIC_LEN / TAIL_LEN / CHART_END` 是**每曲目**的（`let`）。切歌流程：

```
prepareSong(song) → Sound.reset() → applyTimeline() → Sound.prepare() → loadChart()
```

### 每首歌一组轮播背景

`#scene-bg` 本身**没有底图**，画面全部来自两组轮播图层：

```html
<div id="scene-bg"><div class="bg-set set-summer">6 × .bg-slide</div>
                   <div class="bg-set set-kaze">7 × .bg-slide</div></div>
```

- `SONGS[].bgClass`（`song-summer` / `song-kaze`）由 `syncSongUI()` 挂到 `#scene-bg` 上，只有匹配的那组 `display:block`，另一组整组不渲染、不跑动画。
- 组内每张 `.bg-slide` 用 `@keyframes bgCycle6 / bgCycle7` 交叉淡入：每张停留 6s、淡入淡出各 1.8s。
  **淡入的那张在 DOM 里一定排在淡出的那张之后**（画在上层），所以任一时刻都有一层 `opacity:1`，既不露底也不闪黑。
- 第一张用 `bgCycle6First / bgCycle7First`（0% 就是不透明），否则首帧会空白 1.8s。
- 伪元素 `::before`（压暗渐变）必须显式 `z-index:2`，否则会被轮播层盖掉。
- 降低动效（`body.reduced`）时不轮播，每组停在第一张。

图片 base64 在样式表标记块里，由 `tools/build-bg-slides.py` 生成，**不要手工编辑**：

```
/*<<<BG_SUMMER>>>*/ … /*<<<END_BG_SUMMER>>>*/
/*<<<BG_KAZE>>>*/   … /*<<<END_BG_KAZE>>>*/
```

夜景那组另有一套 `filter`（提亮到 `brightness(.88)`）和偏冷的压暗层——照抄白天那套会把夜图糊成一片黑、把天空压成脏绿。

### 单文件约束（改代码前必读）

- **所有资源全部内联**（含背景图）。当前 `index.html` 约 3.3 MB，上限 5 MB。
- 音频以 base64 字符串内联，并用标记块圈住：

  ```
  /*<<<SONG_KAZE>>>*/ … /*<<<END_SONG_KAZE>>>*/
  ```

  这两个标记之间的内容由 `tools/build-song.py` 重新生成，**不要手工编辑**。
- `design/tokens.css` 内联在 `<style>` 顶部；改 UI 前先对一遍 `design/interaction-spec.md` 与 `design/visual-spec.md` 里的 design token。

---

## 目录结构

```
index.html            游戏本体（唯一交付物，自包含；含内嵌的谱面实验室）
chart-lab.html        谱面实验室的独立来源副本（合并进 index.html 后保留备查）
design/
  interaction-spec.md 交互与可用性规范（判定时序、难度曲线、可访问性）
  visual-spec.md      视觉设计规范（令牌、组件、保护区铁律）
  tokens.css          设计令牌（已内联进 index.html）
  visual-board.html   视觉对照板
assets/
  summer-01..06.jpg    夏季轮播背景的压缩版（成品已内嵌进 index.html）
  kaze-01..07.jpg      夜景轮播背景的压缩版（成品已内嵌进 index.html）
tools/
  build-song.py       一键把新歌装进 index.html
  build-bg-slides.py  一键把一组背景图压成轮播图层并内嵌进 index.html
  merge-lab.py        把 chart-lab 合并进 index.html（可重复执行，--check 自检）
  ncm2audio.py        NCM 解密
  song2chart.py       音频 onset 分析
  browser-test.js     全量回归测试（CDP，可带 --shots 出截图）
  test-songs.js       多曲目专项测试
  test-lab-inline.js  内嵌谱面实验室专项测试
  chartgen*.js / diag-*.js / density-check.js / sync-check.js …
                      谱面生成与各类诊断脚本
  shot-*.js           各界面截图脚本（产物在 tools/shots/，不入库）
```

---

## 谱面实验室（已并入 index.html）

编辑台现在**就在游戏页面里**：右下角「谱面实验室」小字入口（`#btn-lab`，
`opacity:.22`，hover 才亮），点开是一整块 `#lab-root` 面板，右侧还有返回按钮。
仍然是**单个 HTML**，`chart-lab.html` 只作为独立开发的来源副本保留。

合并由 `tools/merge-lab.py` 完成（可重复执行，逐块处理：块在就替换、块丢了按锚点补回），
注入四个标记块：

```
/* <<<LAB_CSS>>>*/     主 <style> 末尾
<!--<<<LAB_HTML>>>--> 主 script 之前，整块 #lab-root
<!--<<<LAB_CELLS>>>--> 主 script 之后，内联 lab-cells.js 数据
<!--<<<LAB_JS>>>*/     最后，编辑台脚本
```

合并时做了四件**必须保留**的变换：

1. **CSS 作用域化**：所有选择器加 `#lab-root` 前缀，`:root`/`body` 都映射成 `#lab-root`，
   lab 的主题变量因此不污染游戏。
2. **id 全部改名 `lab-`**：两边有同名 id，且 lab 用 `$('#map')` 这种引号内选择器——
   改名正则要同时覆盖 `id="x"` / `for="x"` / `getElementById` / `#x`。
3. **脚本 IIFE → 具名 `chartLabMain()`**：首次点开才执行，启动时零开销。
4. **DOM 查询收进 `LR`**：`document.querySelector` → `LR.querySelector`，
   否则 `$('#say')` 查不到、且 lab 的 `[data-diff]` 查询会误点亮游戏标题页的难度卡。

功能：2/4/8 键位切换、全曲密度总谱、竖屏长卷、实速扫掠试听、手工增删音符、
三级候选点位；右侧「导出参数」把调好的数值抄回 `index.html` 的 `DIFFS`。

**改完 index.html 一定要跑 `py tools/merge-lab.py --check`**：
构建期间 index.html 被别的改动动过时，`LAB_CSS` 这类块可能被整个冲掉。

---

## 加一首新歌

```bash
py tools/build-song.py -i "<file>.ncm" --bitrate 160k --name KAZE
```

脚本依次完成：NCM 解密 → 重编码为体积可控的 mp3 → **分析这份成品**（而不是原文件，避免转码偏移）→ base64 注入标记块。
可选 `--mono`（省一半体积）、`--html`、`--keep`（保留中间产物于 `_tmp/`）。
注入后还要在 `SONGS` 里补一条记录（`id / kind / title / timeline / bgClass`）。

---

## 加一组轮播背景

```bash
py tools/build-bg-slides.py -i "A.jpg" "B.jpg" "C.jpg" --prefix summer \
    --width 1280 --quality 72 --crop-top 24
```

- 流程：裁掉顶部播放器 OSD → 等比缩到 `--width` → JPEG `--quality` → 落一份压缩版到
  `assets/<prefix>-NN.jpg` → base64 注入 `index.html` 的 `/*<<<BG_<PREFIX>>>*/` 标记块
  （`--prefix summer` → `BG_SUMMER`，`kaze` → `BG_KAZE`）。
- `--prefix` 决定组名：`summer` → `.set-summer` + `bgCycle6`（6 张 / 36s），
  `kaze` → `.set-kaze` + `bgCycle7`（7 张 / 42s）。改组数要同步改 `index.html` 里的
  `@keyframes` 与 `animation-delay` 序列。
- 标记块内的 CSS 完全由脚本生成，**不要手工编辑**；想改淡入时长/取景去改标记块之外的
  `.bg-slide` 规则。
- 组内张数上限 9（CSS 只生成了 `s1..s9` 类名）。夜景要更高的 `--quality`
  （q84 vs q72），否则渐变出色带。

---

## 测试

```bash
node tools/browser-test.js [--shots]   # 全量回归 + 可选截图
node tools/test-songs.js               # 多曲目专项测试
node tools/shot-title.js <out.png> [songId]   # 标题页截图
node tools/shot-bg.js [songId] [outDir]       # 标题页 + 游戏内两个状态
node tools/shot-bg-slides.js [songId]         # 逐帧抓轮播每一张
node tools/test-bg-perf.js             # 背景配置的帧率 A/B
```

脚本通过 CDP 驱动本机 Chrome（已自动探测 `C:/Program Files (x86)/Google/Chrome/Application/chrome.exe`）。

---

## 环境约定

- Python 用 `py`（`D:\Env\Python314`），不要裸用 `python`（那是 workbuddy 自带版，没装依赖）。
  依赖：`py -m pip install imageio-ffmpeg numpy pycryptodome Pillow`。
- 性能与时序类断言会随机器负载漂移（fps 阈值尤其明显）。拿不准就在**同一会话内**用旧版本（`git show <旧commit>:index.html` 临时覆盖，测完还原）跑同一脚本做 A/B，**不要直接改断言**。

## 已知陷阱

- NCM 新版客户端的 metadata 密钥解不开，但音频正文不需要 metadata，靠 ID3 / fLaC 魔数判格式即可。
- 重编码会引入几十毫秒偏移，必须分析**重编码后的成品**。
- `practice` 是难度档，`warmup` 是辅助模式——两者曾经撞名导致新难度被当成辅助模式不记分。
- `#stage.is-title #scene-bg` 特异性 (2,1,1) 高于 `#scene-bg.song-x` (1,1,1)，标题态的 `filter` / `::after` 必须单独写 `.song-x` 版本，否则被默认规则盖掉。
- 判断 `background-position` 有没有用，先算一遍：舞台恒 3:2，常见截图是 16:9，纵向从来不裁。
- 轮播动画的选择器要按**组**作用域写（`#scene-bg .set-summer .bg-slide`），
  写成 `#scene-bg.song-summer .bg-slide` 会连带命中另一组的图层。
- 隐藏的 `.bg-set`（`display:none`）里的图层，computed opacity 仍是 1，这是浏览器不渲染的
  假象——别据此判断轮播是否重叠。
