#!/usr/bin/env python3
"""由色序实测数据生成预览页与缩略图。
用法: python3 color_preview.py <上游参考包根> <交付根> [标准片段目录]
给出标准片段目录时读 v3 数据（全 30 组动态），否则读 v2。"""
import json, os, sys, subprocess, html, csv
PKG, OUT = sys.argv[1], sys.argv[2]; CL = sys.argv[3] if len(sys.argv) > 3 else None; V = 'v3' if CL else 'v2'
D = json.load(open(os.path.join(OUT, '色序/色序_v3_实测数据.json' if CL else '色序/色序_实测数据.json')))
IDX = {x['id']: x for x in json.load(open(os.path.join(PKG, '30画风色序参考/30画风_颜色与来源索引.json')))}
ROWS = {r['编号']: r for r in csv.DictReader(open(os.path.join(OUT, f'色序/30画风播放顺序_{V}.csv'), encoding='utf-8-sig'))}
VER = {} if not CL else {r['从']: r for r in csv.DictReader(open(os.path.join(OUT, '色序/色序v3_切点验证.csv'), encoding='utf-8-sig'))}
TH = os.path.join(OUT, f'色序/thumbs_{V}'); os.makedirs(TH, exist_ok=True)
S = {s['id']: s for s in D['styles']}
def thumb(src, dst, t=None):
    a = ['ffmpeg', '-v', 'error', '-y'] + (['-ss', str(t)] if t is not None else []) + ['-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', dst]
    subprocess.run(a, check=True)
for sid, s in S.items():
    if CL:
        thumb(os.path.join(CL, f'{sid}_A.mp4'), f'{TH}/{sid}_A.jpg', 4); thumb(os.path.join(CL, f'{sid}_B.mp4'), f'{TH}/{sid}_B.jpg', 4); continue
    if s['how'].startswith('成片'):
        thumb(os.path.join(PKG, f'参考视频/{sid}_A_8秒.mp4'), f'{TH}/{sid}_A.jpg', 4)
        thumb(os.path.join(OUT, f'完成片/{sid}_B_8s.mp4'), f'{TH}/{sid}_B.jpg', 4)
    else:
        c = IDX[sid]['cases']; thumb(os.path.join(PKG, c['a']['poster']), f'{TH}/{sid}_A.jpg')
        bp = (c.get('b') or {}).get('poster'); thumb(os.path.join(PKG, bp or c['a']['poster']), f'{TH}/{sid}_B.jpg')
def sw(m):
    m = m.get('all', m)
    return f'<span class="sw" style="background:{m["hex"]}"></span><code>{m["hex"]}</code> {"黑白 L" + str(m["lum"]) if m["hue"] is None else str(m["hue"]) + "°"}'
cards = []
for k, sid in enumerate(D['order']):
    s, r = S[sid], ROWS[sid]
    if CL:
        vr = VER.get(sid)
        tr = '' if not vr else f'<div class="tr">↓ 切点 {vr["切点"]}（{vr["时间"]}）实测：上层 {html.escape(vr["上层差"])} · 中层 {html.escape(vr["中层差"])} · {html.escape(r["切点·材质"])} · <b>{vr["判定"]}</b></div>'
        tag = '动态取色' + ('（B 无视频·静帧）' if s['B']['src'].startswith('无视频') else '')
    else:
        tr = '' if k == len(D['order']) - 1 else f'<div class="tr">↓ 上层 A {html.escape(r["到下一组·上层A"])} · 中层 B {html.escape(r["到下一组·中层B"])} · {html.escape(r["到下一组·材质"])} · 切换分 {r["切换分"]}</div>'
        tag = '这次成片·动态取色' if s['how'].startswith('成片') else '静态帧取色'
    cards.append(f'''<section><div class="no">{k + 1:02d}</div><div class="body"><h2>{sid} {html.escape(s["name"])} <small>材质：{html.escape(s["mat"])} · 旧序 {s["old"]} · <em>{tag}</em></small></h2>
<div class="pair"><figure><img src="thumbs_{V}/{sid}_A.jpg"><figcaption>上层 A　{sw(s["A"])}</figcaption></figure><figure><img src="thumbs_{V}/{sid}_B.jpg"><figcaption>中层 B　{sw(s["B"])}</figcaption></figure></div></div></section>{tr}''')
hx = lambda m: m.get('all', m)['hex']
strip = ''.join(f'<div title="{sid}"><i style="background:{hx(S[sid]["A"])}"></i><i style="background:{hx(S[sid]["B"])}"></i><b>{k + 1}</b></div>' for k, sid in enumerate(D['order']))
if CL:
    good = sum(v['判定'] == '好' for v in VER.values()); mid = sum(v['判定'] == '一般' for v in VER.values()); weak = sum(v['判定'] == '弱' for v in VER.values())
    NOTE = (f'<b>v3 已验证：</b>30 组 A/B 全部按所选 8 秒窗动态取色（S11 的 B 没有视频地址，只能用静帧）。排序按切点两侧各 0.5 s 的实际颜色算分；然后按这个顺序拼出 9:16 全序预览（上层 A、中层 B），并在拼好的成品上逐切点复测：'
            f'好 {good}、一般 {mid}、弱 {weak}。同一份数据下：v3 总分 {D["score"]}，v2 顺序 {D["score_v2_order"]}，旧预排 {D["score_old_order"]}。<br>'
            '文件：<a href="色序v3_全序预览_9x16.mp4">色序v3_全序预览_9x16.mp4</a>（240 s）· <a href="色序v3_切点验证.csv">切点验证表</a> · <a href="色序v3_切点总览_1.jpg">切点总览 1</a> / <a href="色序v3_切点总览_2.jpg">2</a> · <a href="30画风播放顺序_v3.csv">顺序表</a>')
else:
    NOTE = None
TITLE = '30 画风播放色序 · v3（全 30 组动态，已验证）' if CL else '30 画风播放色序 · 预排 v2'
page = f'''<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>30 画风色序</title>
<style>:root{{--bg:#f4f3ef;--fg:#1a1a1a;--line:#1a1a1a;--acc:#c8322a}}body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"PingFang SC",sans-serif}}
main{{max-width:1200px;margin:0 auto;padding:16px 16px 80px}}h1{{font-size:24px;margin:8px 0}}.note{{border:1px solid var(--line);padding:10px 14px;margin:10px 0 18px}}
.strip{{display:flex;border:1px solid var(--line);margin-bottom:20px}}.strip div{{flex:1;display:flex;flex-direction:column;align-items:center}}.strip i{{display:block;width:100%;height:26px}}.strip b{{font-size:11px;padding:2px 0}}
section{{display:flex;border-top:1px solid var(--line);padding:12px 0}}.no{{font:700 28px/1 ui-monospace,monospace;width:56px;color:var(--acc)}}.body{{flex:1}}h2{{margin:0 0 8px;font-size:18px}}h2 small{{font-weight:400;font-size:13px}}em{{font-style:normal;color:var(--acc)}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}figure{{margin:0}}img{{width:100%;border:1px solid var(--line);display:block}}figcaption{{font-size:13px;margin-top:4px}}.sw{{display:inline-block;width:14px;height:14px;border:1px solid var(--line);vertical-align:-2px;margin-right:4px}}
.tr{{margin:0 0 0 56px;padding:6px 10px;border-left:3px solid var(--acc);font-size:13px}}@media(max-width:700px){{.pair{{grid-template-columns:1fr}}.no{{width:40px}}.tr{{margin-left:40px}}}}</style></head>
<body><main><h1>{TITLE}</h1>
{'<div class="note">' + NOTE + '</div>' if NOTE else ''}<div class="note">模型：9:16 成片里上层 A、中层 B 同步 8 秒，换画风时两层同时换色。切换分由三部分组成：上层色差、中层色差、材质是否交替。彩色层要求色相差接近 180°；黑白或低饱和层改看明暗反差。少女与猫 A 不相邻，卡尔 B 尽量拉开。开场沿用旧表的蓝图。{"" if CL else f"同一套算分标准下，总分 {D['score']}，旧预排 {D['old_score']}。"}<br>
<b>限制：</b>{"源视频里有日文字幕的组（S04/S14/S03 等，旧表标着需汉化）在终剪前要换成中文；S37 的 A 窗开头约 0.5 s 是黑场。" if CL else "这次 13 组按成片动态取色（每 0.5 s 一帧）；另外 17 组只有上游参考包里的静态帧，所以这仍是预排，没有做全 30 组的动态验证和拼接。"}主色按"饱和度 × 亮度"加权的面积统计，大面积背景会压过小面积主体（例如 S34 的 A 取到的是淡紫背景，不是粉字）。</div>
<div class="strip">{strip}</div>{"".join(cards)}</main></body></html>'''
open(os.path.join(OUT, '色序/色序预览.html' if CL else '色序/色序预览_v2.html'), 'w').write(page); print('ok', len(D['order']))
