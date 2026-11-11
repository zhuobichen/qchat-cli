#!/usr/bin/env python3
"""S35 粒子聚散造型 B（英文讲解版）：结尾一拍 MAYBE THE CAT CHOSE US。
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
做法（对齐上游参考包 S35 配方：粒子要多、形状要给定）：
- 60,000 颗暖琥珀色粒子；每个目标形状先画成实心遮罩（村子剪影、坐着的猫和人、两行字幕），再从遮罩里采样目标点，三成采在轮廓带上让边缘更清楚。
- 每颗粒子的位置是一串嵌套插值：初始星云 → 村子 → 旋涡 → 猫和人 / 字幕。每段各自错开起点，用带回弹的弹簧缓动，路径上加一个垂直方向的弧形偏移，过渡时再叠 curl noise 漂移。
- 渲染全用 numpy：每帧取三个子时刻做运动模糊，双线性 splat 到累加缓冲（bincount 加法混合），再叠三层不同半径的模糊做辉光，最后做一次指数色调映射。
- 背景是冷色深蓝渐变加少量闪烁的冷色星点，平均亮度保持在 20/255 左右，QA 不会判成黑帧。
- 右上角计数器显示当前锁定在形状里的粒子数，聚拢时上涨、散开时回落。
节拍：0–1.9 s 星云聚成村子（圆屋、陶罐、谷仓穹顶、麦穗）→ 1.9–2.9 s 村子呼吸闪烁 → 2.9–3.9 s 从左到右卷成旋涡 →
3.7–5.3 s 重新聚成坐着的猫和伸手的人 → 5.0–6.0 s 字幕 MAYBE… 由粒子拼出 → 5.9–6.9 s THE CAT CHOSE US 拼出 → 停到 8 s。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, FPS, N = 1920, 1080, 30, 240
NP = 60000
AV = '/System/Library/Fonts/Avenir Next.ttc'
F_BIG = ImageFont.truetype(AV, 112, index=8)            # Heavy，大写高 79 px
F_MID = ImageFont.truetype(AV, 84, index=8)             # 大写高 59 px
F_NUM = ImageFont.truetype(AV, 48, index=2)             # Demi Bold
F_LBL = ImageFont.truetype(AV, 26, index=2)
rng = np.random.default_rng(35)
GY = 770

# —— 形状遮罩 ——
def blank(): return np.zeros((H, W), np.uint8)
def P(pts): return np.round(np.asarray(pts, np.float32) * 16).astype(np.int32)
def ell(m, cx, cy, ax, ay, ang=0, v=255): cv2.ellipse(m, (int(cx * 16), int(cy * 16)), (int(ax * 16), int(ay * 16)), ang, 0, 360, v, -1, cv2.LINE_AA, 4)
def poly(m, pts, v=255): cv2.fillPoly(m, [P(pts)], v, cv2.LINE_AA, 4)
def thick(m, pts, th, v=255):
    pts = np.asarray(pts, np.float32); th = np.broadcast_to(np.asarray(th, np.float32), (len(pts),))
    for k in range(len(pts) - 1):
        for u in np.linspace(0, 1, 12):
            p = pts[k] + (pts[k + 1] - pts[k]) * u; r = (th[k] + (th[k + 1] - th[k]) * u) / 2
            cv2.circle(m, (int(p[0] * 16), int(p[1] * 16)), int(r * 16), v, -1, cv2.LINE_AA, 4)
def jar(m, cx, R, h):
    v = np.array([0, 0.1, 0.35, 0.6, 0.8, 0.9, 1.0]); r = np.array([0.55, 0.8, 0.98, 1.0, 0.75, 0.5, 0.62])
    pts = [(cx - rr * R, GY - vv * h) for vv, rr in zip(v, r)] + [(cx + rr * R, GY - vv * h) for vv, rr in zip(v[::-1], r[::-1])]
    poly(m, pts)

def village():
    m = blank()
    cv2.rectangle(m, (220, GY), (1700, GY + 12), 255, -1)                      # 地面
    poly(m, [(300, GY), (308, 600), (532, 600), (540, GY)])                     # 圆屋 A
    poly(m, [(262, 612), (420, 436), (578, 612)])
    jar(m, 640, 46, 170); jar(m, 742, 56, 212); jar(m, 846, 46, 170)            # 陶罐
    cv2.ellipse(m, (1010 * 16, GY * 16), (118 * 16, 236 * 16), 0, 180, 360, 255, -1, cv2.LINE_AA, 4)   # 谷仓穹顶
    poly(m, [(1180, GY), (1186, 622), (1394, 622), (1400, GY)])                # 圆屋 B
    poly(m, [(1150, 632), (1290, 478), (1430, 632)])
    for k, x in enumerate(range(1478, 1640, 22)):                               # 麦穗
        sw = 14 * math.sin(k * 1.7); top = 600 + 24 * math.sin(k * 2.3)
        thick(m, [(x, GY), (x + sw * 0.5, (GY + top) / 2), (x + sw, top + 20)], 5)
        ell(m, x + sw, top, 7, 22, int(sw))
    holes = blank()                                                             # 门洞、窗洞挖空
    poly(holes, [(396, GY), (396, 700), (444, 700), (444, GY)]); ell(holes, 420, 700, 24, 24)
    poly(holes, [(990, GY), (990, 722), (1030, 722), (1030, GY)]); ell(holes, 1010, 722, 20, 20)
    cv2.rectangle(holes, (1262, 668), (1312, 708), 255, -1)
    for x0, x1, y in ((308, 532, 655), (1186, 1394, 650)): cv2.rectangle(holes, (x0, y), (x1, y + 4), 255, -1)
    m[holes > 0] = 0
    return m

def pair():
    m = blank()
    cv2.rectangle(m, (560, GY), (1330, GY + 10), 255, -1)
    # 人：头、躯干、腿、一只手垂下、一只手伸向猫
    ell(m, 760, 336, 40, 44); poly(m, [(746, 372), (774, 372), (776, 396), (744, 396)])
    poly(m, [(708, 392), (812, 392), (798, 566), (722, 566)]); ell(m, 718, 404, 22, 22); ell(m, 802, 404, 22, 22)
    thick(m, [(742, 556), (738, 660), (735, 760)], [40, 34, 28]); thick(m, [(780, 556), (786, 660), (792, 760)], [40, 34, 28])
    ell(m, 728, 764, 26, 10); ell(m, 800, 764, 26, 10)
    thick(m, [(712, 404), (694, 486), (688, 566)], [26, 22, 18]); ell(m, 688, 574, 12, 15)
    thick(m, [(806, 404), (852, 470), (910, 518)], [26, 22, 18]); ell(m, 922, 526, 15, 12, 30)
    # 猫：坐姿、朝左看着人
    ell(m, 1108, 722, 72, 50); ell(m, 1072, 668, 50, 88, 14); ell(m, 1038, 660, 34, 56)
    ell(m, 1022, 578, 43, 37); ell(m, 992, 590, 19, 15)
    poly(m, [(993, 566), (989, 512), (1020, 548)]); poly(m, [(1024, 548), (1042, 506), (1058, 560)])
    thick(m, [(1032, 690), (1028, 764)], 19); thick(m, [(1058, 700), (1055, 764)], 19)
    ell(m, 1024, 766, 15, 7); ell(m, 1050, 766, 15, 7)
    thick(m, [(1160, 752), (1202, 766), (1238, 756), (1254, 726), (1250, 700)], [18, 16, 14, 12, 11])
    holes = blank(); ell(holes, 1008, 572, 6, 4, -20)                           # 猫眼
    cv2.line(holes, (1043 * 16, 700 * 16), (1046 * 16, 760 * 16), 255, 3, cv2.LINE_AA, 4)   # 两条前腿之间的缝
    m[holes > 0] = 0
    return m

def textmask(s, f, cy):
    im = Image.new('L', (W, H), 0); ImageDraw.Draw(im).text((W / 2, cy), s, font=f, fill=255, anchor='mm'); return np.asarray(im).copy()
CAP1 = ('MAYBE…', F_MID, 862); CAP2 = ('THE CAT CHOSE US', F_BIG, 962)

def sample(m, n, edge=0.3, seed=0):
    r = np.random.default_rng(seed); b = m > 110
    e = b & ~(cv2.erode(m, np.ones((5, 5), np.uint8)) > 110)
    pi, pe = np.argwhere(b), np.argwhere(e); ne = int(n * edge)
    a = np.vstack([pi[r.integers(0, len(pi), n - ne)], pe[r.integers(0, len(pe), ne)]]).astype(np.float32)
    a = a[r.permutation(n)] + r.uniform(-0.5, 0.5, (n, 2)); return a[:, ::-1].copy()   # → (x, y)

# —— 粒子属性与目标 ——
VIL = sample(village(), NP, 0.32, 1)
NT1, NT2 = 5200, 10800
NPAIR = NP - NT1 - NT2
perm = rng.permutation(NP); I_PAIR, I_T1, I_T2 = perm[:NPAIR], perm[NPAIR:NPAIR + NT1], perm[NPAIR + NT1:]
FIN = np.zeros((NP, 2), np.float32)
FIN[I_PAIR] = sample(pair(), NPAIR, 0.3, 2)
T1M, T2M = textmask(*CAP1), textmask(*CAP2)
FIN[I_T1] = sample(T1M, NT1, 0.25, 3); FIN[I_T2] = sample(T2M, NT2, 0.25, 4)
r1, r2, r3, r4, r5 = (rng.random(NP).astype(np.float32) for _ in range(5))
SGN = np.where(rng.random(NP) < 0.5, -1.0, 1.0).astype(np.float32)
# 初始星云：中心偏亮的旋转圆盘
RHO0 = (np.sqrt(rng.random(NP)) * 430 + 20).astype(np.float32)
TH0 = (rng.integers(0, 2, NP) * np.pi + 0.009 * RHO0 + rng.normal(0, 0.38, NP)).astype(np.float32)   # 两条旋臂
# 旋涡：散开时的半径和相位
RHO1 = (rng.gamma(2.0, 95, NP) + 40).astype(np.float32).clip(40, 720); TH1 = (rng.integers(0, 3, NP) * 2 * np.pi / 3 + 0.012 * RHO1 + rng.normal(0, 0.28, NP)).astype(np.float32)   # 三条旋臂
CEN = np.array([960, 560], np.float32)
# 时间表（秒）
T_SPAWN = 0.8 * r5 - 0.25                                                    # 0–0.9 s 逐渐亮起
G0 = 0.15 + 0.55 * r1; GD = 1.0 + 0.25 * r2                            # 聚成村子
S0 = 2.85 + 0.55 * (VIL[:, 0] - 220) / 1480 + 0.15 * r3; SD = 0.8 + 0.2 * r2   # 从左到右卷走
F0 = np.zeros(NP, np.float32); FD = np.zeros(NP, np.float32)
F0[I_PAIR] = 3.75 + 0.5 * r4[I_PAIR]; FD[I_PAIR] = 1.0 + 0.2 * r2[I_PAIR]
F0[I_T1] = 4.95 + 0.3 * r4[I_T1]; FD[I_T1] = 0.75
F0[I_T2] = 5.85 + 0.35 * r4[I_T2]; FD[I_T2] = 0.8
T_CAP1 = 4.95 + 0.3 + 0.75; T_CAP2 = 5.85 + 0.35 + 0.8                 # 字幕粒子全部到位的时刻
# 颜色（BGR）与亮度
PAL = np.array([[40, 150, 255], [90, 190, 255], [170, 225, 255], [25, 100, 240]], np.float32) / 255
COL = PAL[rng.choice(4, NP, p=[0.45, 0.3, 0.15, 0.1])]
BRI = (0.5 + 0.5 * rng.random(NP)).astype(np.float32); BRI[rng.random(NP) < 0.02] *= 3.0
TWF = rng.uniform(2, 7, NP).astype(np.float32); TWP = rng.uniform(0, 6.3, NP).astype(np.float32)

def spring(u):
    u = np.clip(u, 0, 1); return np.where(u >= 1, 1.0, 1 - np.exp(-6 * u) * (np.cos(8 * u) + 0.75 * np.sin(8 * u))).astype(np.float32)
def curl(p, t, amp):
    """二维 curl noise：对流函数 ψ = Σ a·sin(k·x + ωt + φ) 求旋度，得到无散度的漂移场。"""
    vx = np.zeros(len(p), np.float32); vy = np.zeros(len(p), np.float32)
    for kx, ky, w, ph, a in ((0.006, 0.004, 0.9, 0.3, 1.0), (-0.004, 0.009, 1.3, 2.1, 0.7), (0.011, -0.007, 0.7, 4.0, 0.5), (0.017, 0.013, 1.9, 1.1, 0.3)):
        c = np.cos(kx * p[:, 0] + ky * p[:, 1] + w * t + ph) * a
        vx += c * ky; vy -= c * kx
    s = amp / 0.012; return np.stack([vx * s, vy * s], 1)
def disc(rho, th, t, spin):
    a = th + spin * t * (300 / (rho + 120)); return CEN + np.stack([rho * np.cos(a) * 1.25, rho * np.sin(a) * 0.62], 1)

def positions(t):
    """嵌套插值：星云 → 村子 → 旋涡 → 终形，每段一个弹簧缓动和一个弧形偏移。返回位置和“已锁定”标记。"""
    p = disc(RHO0, TH0, t, 0.55)
    loose = np.ones(NP, np.float32); locked = np.zeros(NP, bool)
    for tgt, t0, d, arc in ((lambda: VIL, G0, GD, 0.35), (lambda: disc(RHO1, TH1, t, 1.5), S0, SD, 0.5), (lambda: FIN, F0, FD, 0.3)):
        u = (t - t0) / d; act = u > 0
        if not act.any(): continue
        T = tgt(); e = spring(u)[:, None]; dv = T - p
        perp = np.stack([-dv[:, 1], dv[:, 0]], 1) * (arc * SGN * np.sin(np.pi * np.clip(u, 0, 1)))[:, None]
        p = np.where(act[:, None], p + dv * e + perp, p)
        if tgt is not None:
            settle = np.clip(u, 0, 1); loose = np.where(act, 1 - settle, loose)
            locked = np.where(act, (u > 0.75) & (arc != 0.5), locked)
    # 漂移：没锁定时大幅 curl 漂移，锁定后只剩轻微呼吸
    p = p + curl(p, t, 1.0) * (2.0 + 26.0 * loose)[:, None]
    return p, locked

# —— 背景 ——
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rr = np.hypot((xx - W * 0.5) / W, (yy - H * 0.45) / H)
BG = np.stack([np.interp(rr, [0, 0.75], [70, 26]), np.interp(rr, [0, 0.75], [34, 12]), np.interp(rr, [0, 0.75], [20, 7])], -1).astype(np.float32) / 255
STAR = rng.random((300, 2)) * [W, H]; STAR = STAR[(STAR[:, 1] < 520) | (rng.random(300) < 0.3)]
STF = rng.uniform(1, 4, len(STAR)); STP = rng.uniform(0, 6.3, len(STAR))

def splat(acc, p, wcol):
    x, y = p[:, 0], p[:, 1]; ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
    x, y, wcol = x[ok], y[ok], wcol[ok]; x0 = x.astype(np.int32); y0 = y.astype(np.int32); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    for dx, dy, wt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        idx = (y0 + dy) * W + (x0 + dx); ww = wcol * wt
        for c in range(3): acc[:, c] += np.bincount(idx, weights=ww[:, c], minlength=W * H)

def blur(a, s):
    if s <= 4: return cv2.GaussianBlur(a, (0, 0), s)
    k = int(s // 3); sm = cv2.resize(a, (W // k, H // k), interpolation=cv2.INTER_AREA)
    return cv2.resize(cv2.GaussianBlur(sm, (0, 0), s / k), (W, H), interpolation=cv2.INTER_LINEAR)

def frame(i):
    t = i / FPS; acc = np.zeros((W * H, 3), np.float64)
    vis = np.clip((t - T_SPAWN) / 0.35, 0, 1) if t < 1.3 else 1.0
    tw = 0.75 + 0.25 * np.sin(TWF * t + TWP)
    wcol = (COL * (BRI * tw * vis * 0.85)[:, None]).astype(np.float32)
    for k in range(3):                                                   # 三个子时刻 = 运动模糊（快门约 0.8 帧）
        p, locked = positions(t - k * 0.8 / (2 * FPS)) if k else positions(t)
        if k == 0: nlock = int((locked & (vis >= 1 if np.isscalar(vis) else vis >= 1)).sum())
        splat(acc, p.astype(np.float32), wcol / 3)
    core = acc.reshape(H, W, 3).astype(np.float32)
    glow = blur(core, 2.0) * 0.8 + blur(core, 8) * 1.0 + blur(core, 30) * 1.2
    light = core * 1.6 + glow
    # 字幕：粒子到位后叠一层实体字，保证缩小后可读
    cap = np.zeros((H, W), np.float32)
    a1 = np.clip((t - (T_CAP1 - 0.25)) / 0.5, 0, 1); a2 = np.clip((t - (T_CAP2 - 0.25)) / 0.5, 0, 1)
    if a1 > 0: cap += T1M.astype(np.float32) / 255 * a1
    if a2 > 0: cap += T2M.astype(np.float32) / 255 * a2
    if a1 > 0 or a2 > 0:
        txt = np.array([150, 215, 255], np.float32) / 255
        light += cap[..., None] * txt * 0.55 + blur(cap, 10)[..., None] * np.array([40, 120, 255], np.float32) / 255 * 0.35
    # 星点
    bg = BG.copy()
    for (sx, sy), f, ph in zip(STAR, STF, STP):
        v = 0.25 + 0.2 * math.sin(f * t + ph); x, y = int(sx), int(sy); bg[y, x] += np.array([1.0, 0.85, 0.7], np.float32) * v
    L = light.max(-1, keepdims=True)                                    # 按亮度做色调映射，保住琥珀色相
    out = bg * (1 - 0.6 * np.clip(L, 0, 1)) + light * ((1 - np.exp(-1.3 * L)) / (L + 1e-6))
    out = np.clip(out, 0, 1)
    # 右上角计数器
    im = Image.fromarray((out * 255).astype(np.uint8)[..., ::-1]); d = ImageDraw.Draw(im)
    d.text((1860, 74), 'PARTICLES LOCKED IN SHAPE', font=F_LBL, fill=(150, 170, 205), anchor='rm')
    d.text((1860, 122), f'{nlock:,}', font=F_NUM, fill=(255, 214, 150), anchor='rm')
    d.line([(1560, 152), (1860, 152)], fill=(90, 110, 150), width=1)
    d.line([(1860 - 300 * nlock / NP, 152), (1860, 152)], fill=(255, 190, 110), width=3)
    im.save(os.path.join(OUT, f'{i + 1:04d}.png'), compress_level=1)

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
