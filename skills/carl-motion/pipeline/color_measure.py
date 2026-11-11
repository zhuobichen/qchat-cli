"""色序取色与层间色差函数（与 color_order_v3.py 中同名函数一致），供拼接验证复用。"""
import math
import cv2, numpy as np
def crop_active(f):
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY); cols = np.where(g.mean(0) > 8)[0]; rows = np.where(g.mean(1) > 8)[0]
    if len(cols) > g.shape[1] * 0.5 and len(rows) > g.shape[0] * 0.5: return f[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
    return f
def measure(fs):
    hist = np.zeros(36); chroma = []; lum = []; px = []
    for f in fs:
        f = crop_active(f); hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(float)
        h, s, v = hsv[:, 0] * 2, hsv[:, 1] / 255, hsv[:, 2] / 255; m = (s > 0.25) & (v > 0.15); w = s * v
        hist += np.bincount((h[m] // 10).astype(int) % 36, weights=w[m], minlength=36)
        chroma.append(m.mean()); lum.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).mean() / 255); px.append(np.c_[f.reshape(-1, 3)[m], h[m]])
    sm = sum(np.roll(hist, k) * wk for k, wk in [(-2, .25), (-1, .6), (0, 1), (1, .6), (2, .25)]); pk = int(sm.argmax()); cr = float(np.mean(chroma))
    allpx = np.concatenate(px); near = allpx[np.abs(((allpx[:, 3] - (pk * 10 + 5)) + 180) % 360 - 180) < 25]
    L = round(float(np.mean(lum)), 3)
    if cr < 0.12 or len(near) < 50: g = int(L * 255); return dict(hue=None, chroma=round(cr, 3), lum=L, hex='#%02x%02x%02x' % (g, g, g))
    ang = np.deg2rad(near[:, 3]); hue = (math.degrees(math.atan2(np.sin(ang).mean(), np.cos(ang).mean())) + 360) % 360
    b, g, r = np.median(near[:, :3], 0).astype(int)
    return dict(hue=round(hue, 1), chroma=round(cr, 3), lum=L, hex='#%02x%02x%02x' % (r, g, b))

def layer(a, b):
    if a['hue'] is not None and b['hue'] is not None:
        d = abs((a['hue'] - b['hue'] + 180) % 360 - 180); return (1 - math.cos(math.radians(d))) / 2, f'{d:.0f}°'
    dl = abs(a['lum'] - b['lum']); return 0.85 * min(1, dl / 0.45), f'ΔL {dl:.2f}'
