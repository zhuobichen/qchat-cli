#!/usr/bin/env python3
"""按 29 画风口播脚本排 9:16 素材（A、B 层标签后分别标 Opus5.5、DeepSeek，用各自主题色）：每 8 秒一组，各组版式和节拍完全相同。
用法: python3 script_layout.py <交付根> <1080×608 标准片段目录> <临时目录> [开场编号]
  片段目录由 color_clips.py 以 `1080 608` 参数切出（和色序用的是同一批 8 秒窗）。
  给了开场编号就只出开场候选预览：把 v4 顺序轮转到该组，排前两组，截前 10 秒，
  输出 交付根/脚本/开场候选预览/开场_<编号>_前10秒.mp4 和对应抽帧。
版式（1080×1920）：顶栏 0–120 常驻标题｜上层 A 120–728｜中层 B 736–1344｜底部 1352–1920 口播区：
  左栏从第 0 帧就有画风名和提示语卡（已出一半，剩下的 5 秒内一段段冒完），5.4 s 起加注意条，右栏是卡尔口播机位占位，最底一行是口播字幕。
节拍见 script_data.BEATS。输出 交付根/脚本/30画风口播排版_9x16.mp4 和每组节拍抽帧总览。
"""
import os, subprocess, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import script_data as D

OUT, CL, TMP = sys.argv[1:4]; OPEN = sys.argv[4] if len(sys.argv) > 4 else None
if OPEN: k0 = D.ORDER.index(OPEN); D.S = D.S[k0:] + D.S[:k0]
W, H, FPS, N = 1080, 1920, 30, 240
AY, BY, VH, ZY = 120, 736, 608, 1352           # A 顶、B 顶、视频高、口播区顶（顶栏加高放常驻标题，口播区让出 48）
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
f = lambda size, bold=False: ImageFont.truetype(FONT, size, index=2 if bold else 0)
INK, PAPER, BG, ACC, MUTE = (17, 17, 17), (242, 239, 232), (17, 17, 17), (255, 84, 20), (110, 110, 110)   # 单一强调色，0 圆角，1px 边
CX0, CX1 = 24, 672                              # 左栏
PX0, PY0, PX1, PY1 = 688, ZY + 12, 1068, ZY + 472   # 卡尔机位

NOHEAD = '，。、；：？！）》」』%'

def wrap(text, font, width):
    lines, cur = [], ''
    for ch in text:
        if font.getlength(cur + ch) > width and cur and ch not in NOHEAD: lines.append(cur); cur = ch.lstrip()
        else: cur += ch                         # 标点不放行首，宁可这一行略超一个字
    return lines + [cur] if cur else lines

def header(k):
    im = Image.new('RGB', (W, AY), BG); d = ImageDraw.Draw(im)
    ft = f(52, 1); x = 24; n = str(len(D.S))
    for part, col in zip(D.TITLE.partition(n), [(255, 255, 255), ACC, (255, 255, 255)]):   # 常驻标题，组数用强调色
        d.text((x, 30), part, font=ft, fill=col); x += ft.getlength(part)
    t = f'{k + 1:02d} / {len(D.S)}'; d.text((W - 24 - f(30, 1).getlength(t), 44), t, font=f(30, 1), fill=(200, 200, 196))
    d.line([(0, AY - 1), (W, AY - 1)], fill=(60, 60, 60))
    return np.array(im)[:, :, ::-1]

OPUS, DEEPSEEK = (217, 119, 87), (77, 107, 254)   # 模型主题色：Claude 陶土橙 #D97757、DeepSeek 蓝 #4D6BFE，只用在层标签里的模型名

def tag(*parts):
    """层标签：parts 是 (文字, 颜色) 依次排开，没给颜色的用纸白。"""
    parts = [(p, PAPER) if isinstance(p, str) else p for p in parts]; ft = f(22, 1)
    w = int(sum(ft.getlength(t) for t, _ in parts)) + 20; im = Image.new('RGB', (w, 34), INK); d = ImageDraw.Draw(im); x = 10
    for t, col in parts: d.text((x, 4), t, font=ft, fill=col); x += ft.getlength(t)
    return np.array(im)[:, :, ::-1]

TYPE_FROM = 0.5                                 # 第 0 帧提示语已出的比例

def typed(s, t):
    """t 时刻卡上已出的字数：从一半起，按 1–3 字一段的节奏冒出来，D.TYPE_END 出完。段长用编号做种子，同一组每次一样。"""
    L = len(s['card']); n0 = int(L * TYPE_FROM)
    if t >= D.TYPE_END: return L
    rng = np.random.default_rng(sum(map(ord, s['id']))); cuts, c = [], n0
    while c < L: c = min(L, c + int(rng.integers(1, 4))); cuts.append(c)
    k = int(len(cuts) * max(0.0, t) / D.TYPE_END)
    return cuts[k - 1] if k else n0

def zone(k, s, t):
    """口播区在时刻 t 的画面（只随节拍和打字进度变化，按 key 缓存）。"""
    im = Image.new('RGB', (W, H - ZY), BG); d = ImageDraw.Draw(im); oy = ZY
    R = lambda x0, y0, x1, y1, **kw: d.rectangle([x0, y0 - oy, x1, y1 - oy], **kw)
    T = lambda xy, txt, **kw: d.text((xy[0], xy[1] - oy), txt, **kw)
    # 卡尔机位占位
    R(PX0, PY0, PX1, PY1, fill=(28, 28, 28), outline=(70, 70, 70))
    for txt, y, ft in [('卡尔口播机位', ZY + 200, f(30, 1)), ('实拍替换此框', ZY + 244, f(22))]:
        T(((PX0 + PX1) / 2 - ft.getlength(txt) / 2, y), txt, font=ft, fill=MUTE)
    b0, b1, b2, b3 = [b[0] for b in D.BEATS]
    # 结果前置：画风名和提示语卡从第 0 帧就在，卡上提示语已经出到一半，剩下的按生成的样子一段段往外冒
    R(CX0, ZY + 12, CX1, ZY + 100, fill=ACC)
    nm = s['name']; ft = f(46 if f(46, 1).getlength(nm) < 520 else 38, 1)
    T((CX0 + 20, ZY + 56 - ft.size * 0.62), nm, font=ft, fill=(255, 255, 255))
    T((CX1 - 20 - f(22, 1).getlength(s['id']), ZY + 70), s['id'], font=f(22, 1), fill=(255, 226, 210))
    if True:
        R(CX0, ZY + 110, CX1, ZY + 372, fill=PAPER, outline=INK)
        T((CX0 + 20, ZY + 120), '提示语', font=f(24, 1), fill=ACC)
        n = typed(s, t)
        ft = f(32); lines = wrap(s['card'], ft, CX1 - CX0 - 52); shown, y = n, ZY + 158
        for ln in lines:
            part = ln[:max(0, shown)]; shown -= len(ln)
            T((CX0 + 20, y), part, font=ft, fill=INK); y += 46
        if n < len(s['card']):          # 光标
            done = 0; y = ZY + 158
            for ln in lines:
                if done + len(ln) >= n: x = CX0 + 20 + ft.getlength(ln[:n - done]); break
                done += len(ln); y += 46
            R(int(x) + 2, y + 2, int(x) + 16, y + 38, fill=ACC)
    # 第 4 拍：注意条
    if t >= b3:
        R(CX0, ZY + 382, CX1, ZY + 472, fill=INK, outline=ACC)
        T((CX0 + 20, ZY + 390), '注意', font=f(26, 1), fill=ACC)
        ft = f(26); ls = wrap(s['warn'], ft, CX1 - CX0 - 110)
        for i, ln in enumerate(ls[:2]): T((CX0 + 90, ZY + 390 + i * 38), ln, font=ft, fill=PAPER)
    # 口播字幕
    line = D.spoken(s)[max(i for i, b in enumerate(D.BEATS) if t >= b[0])]
    ft = f(42, 1); x = W / 2 - ft.getlength(line) / 2
    T((x, ZY + 500), line, font=ft, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))
    return np.array(im)[:, :, ::-1]

def seg(k):
    s = D.S[k]; dst = os.path.join(TMP, f'seg_{k:02d}.mp4')
    capA, capB = cv2.VideoCapture(os.path.join(CL, f'{s["id"]}_A.mp4')), cv2.VideoCapture(os.path.join(CL, f'{s["id"]}_B.mp4'))
    hd, ta, tb = header(k), tag('A  ', ('Opus5.5', OPUS), '  ' + s['name']), tag('B  ', ('DeepSeek', DEEPSEEK))
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', dst], stdin=subprocess.PIPE)
    cache = {}
    for i in range(N):
        t = i / FPS; key = (sum(t >= b[0] for b in D.BEATS), typed(s, t))
        if key not in cache: cache[key] = zone(k, s, t)
        fr = np.full((H, W, 3), 17, np.uint8); fr[:AY] = hd
        for cap, y, tg in [(capA, AY, ta), (capB, BY, tb)]:
            ok, v = cap.read(); assert ok and v.shape[:2] == (VH, W), (s['id'], i)
            fr[y:y + VH] = v; fr[y + 12:y + 12 + tg.shape[0], 12:12 + tg.shape[1]] = tg
        fr[ZY:] = cache[key]; p.stdin.write(fr.tobytes())
    p.stdin.close(); assert p.wait() == 0
    return dst

if __name__ == '__main__':
    os.makedirs(TMP, exist_ok=True); os.makedirs(os.path.join(OUT, '脚本'), exist_ok=True)
    if OPEN:                                    # 开场候选预览：前两组截 10 秒
        with Pool(2) as pool: segs = pool.map(seg, range(2))
        pv = os.path.join(OUT, '脚本/开场候选预览'); os.makedirs(pv, exist_ok=True)
        dst = os.path.join(pv, f'开场_{OPEN}_前10秒.mp4'); lst = os.path.join(TMP, 'list.txt')
        open(lst, 'w').write(''.join(f"file '{x}'\n" for x in segs))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-t', '10', '-c:v', 'libx264', '-crf', '20',
                        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst], check=True)
        cap = cv2.VideoCapture(dst); got, i = [], 0
        while True:
            ok, fr = cap.read()
            if not ok: break
            if i in (3, 75, 150, 255, 285): got.append(cv2.resize(fr, (324, 576)))
            i += 1
        cv2.imwrite(os.path.join(pv, f'开场_{OPEN}_抽帧.jpg'), np.hstack(got), [cv2.IMWRITE_JPEG_QUALITY, 85])
        print('frames', i, dst); sys.exit()
    with Pool(4) as pool: segs = pool.map(seg, range(len(D.S)))
    lst = os.path.join(TMP, 'list.txt'); open(lst, 'w').write(''.join(f"file '{x}'\n" for x in segs))
    final = os.path.join(OUT, f'脚本/{len(D.S)}画风口播排版_9x16.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', final], check=True)
    # 抽帧总览：每组取四拍各一帧（0.8 / 2.6 / 4.4 / 7.6 s），6 组一张
    cap = cv2.VideoCapture(final); want = {k * N + int(t * FPS): (k, j) for k in range(len(D.S)) for j, t in enumerate([0.8, 2.6, 4.4, 7.6])}
    got, i = {}, 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        if i in want: got[want[i]] = cv2.resize(fr, (270, 480))
        i += 1
    assert i == N * len(D.S), i
    for p0 in range(0, len(D.S), 6):
        rows = [np.hstack([got[(k, j)] for j in range(4)] + [np.full((480, 6, 3), 255, np.uint8)]) for k in range(p0, min(p0 + 6, len(D.S)))]
        pairs = [np.hstack(rows[r:r + 2]) if r + 1 < len(rows) else np.hstack([rows[r], np.full_like(rows[r], 255)]) for r in range(0, len(rows), 2)]
        cv2.imwrite(os.path.join(OUT, f'脚本/排版抽帧_{p0 // 6 + 1}.jpg'), np.vstack(pairs), [cv2.IMWRITE_JPEG_QUALITY, 82])
    print('frames', i, final)
