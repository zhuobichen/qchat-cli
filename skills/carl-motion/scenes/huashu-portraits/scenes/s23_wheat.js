// S23 梵高厚涂 B：卡尔穿过麦田，麦浪与柏树的方向笔触随风流动，6–8 s 回望。
// 管线照 upstream/09_postimp.js：①平涂底稿 → ②分区流场笔触（天空沿漩涡、麦田沿风、柏树火焰竖笔）＋区域色板
//   → ③角色平涂＋source-atop 细笔触 → ④可见轮廓补线 → ⑤前景麦穗压住腿、会动的高光（太阳光晕）
SCENES['s23_wheat'] = (() => {
  const W = 1920, H = 1080, TAU = Math.PI * 2, { clamp, lerp, ss } = U, P = PAINT;
  const C = { line: '#1c2458', sky: '#2c4fb0', sky2: '#7fa6e6', cloud: '#e8eef8', sun: '#f6d84a', hill: '#3d5fa8', hill2: '#5f8f6a',
    wheat: '#e2b13a', wheat2: '#b98a1c', cypress: '#1f4a2c', cypress2: '#2f6a3a', poppy: '#d9472f' };
  const HZ = 470;                                                     // 地平线
  const SUN = [1560, 150];
  const swirls = [[520, 175, 125, 1], [880, 105, 85, -1], [1210, 205, 140, 1], [300, 330, 70, -1], [1700, 330, 80, 1]];
  const CYP = [1385, 580];                                            // 柏树底

  // ---- 卡尔的走位：走路幅度 amp(t) 积分得到相位和位移（确定性） ----
  const CYCLE = 2.3, SPEED = 190;
  const ampAt = t => ss(0.05, 0.5, t) * (1 - ss(5.5, 6.3, t));
  const Wt = (() => { const n = 8 * 300 + 1, a = new Float64Array(n); for (let i = 1; i < n; i++) a[i] = a[i - 1] + ampAt((i - 0.5) / 300) / 300; return t => a[clamp(Math.round(t * 300), 0, n - 1)]; })();
  const carlAt = t => ({ x: -110 + SPEED * Wt(t), y: 1075, s: 1.36, dir: 1, amp: ampAt(t), phase: TAU * Wt(t) / CYCLE,
    turn: ss(6.15, 6.9, t), tilt: -0.05 * ss(6.15, 6.9, t), smile: 1, blink: (t > 7.2 && t < 7.32) });

  const wind = (x, y, t) => Math.sin(x * 0.0075 - t * 2.3 + y * 0.004) * 0.6 + Math.sin(x * 0.019 - t * 3.6) * 0.25;
  function base(g, t, cx) {
    // 天空
    const sg = g.createLinearGradient(0, 0, 0, HZ); sg.addColorStop(0, C.sky); sg.addColorStop(1, C.sky2); g.fillStyle = sg; g.fillRect(0, 0, W, HZ + 10);
    g.lineCap = 'round';
    swirls.forEach(([x, y, r, d], k) => { for (let ring = 0; ring < 3; ring++) { g.strokeStyle = ring % 2 ? '#9fc0f0' : C.cloud; g.lineWidth = 20 - ring * 5; g.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.12) { const rr = r * (0.2 + a / (Math.PI * 3.2)) * (1 - ring * 0.13), aa = a * d + t * 0.35 * d + k; const px = x + Math.cos(aa) * rr * 1.25, py = y + Math.sin(aa) * rr * 0.62; a ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } });
    // 太阳
    { const hg = g.createRadialGradient(SUN[0], SUN[1], 10, SUN[0], SUN[1], 130); hg.addColorStop(0, '#fff7c8'); hg.addColorStop(0.45, '#f4d65a'); hg.addColorStop(1, 'rgba(140,170,230,0)'); g.fillStyle = hg; g.beginPath(); g.arc(SUN[0], SUN[1], 130, 0, TAU); g.fill(); }
    // 远山（蓝紫/绿两层）
    g.fillStyle = C.hill; g.beginPath(); g.moveTo(0, HZ + 10); for (let x = 0; x <= W; x += 40) g.lineTo(x, HZ - 40 - 30 * Math.sin(x * 0.004 + 1) - 18 * Math.sin(x * 0.011)); g.lineTo(W, HZ + 10); g.closePath(); g.fill();
    g.fillStyle = C.hill2; g.beginPath(); g.moveTo(0, HZ + 12); for (let x = 0; x <= W; x += 40) g.lineTo(x, HZ - 12 - 14 * Math.sin(x * 0.007 + 2.5)); g.lineTo(W, HZ + 12); g.closePath(); g.fill();
    // 远处橄榄树团
    [[210, HZ - 18, 46], [330, HZ - 10, 34], [1660, HZ - 20, 52], [1790, HZ - 8, 36], [980, HZ - 6, 26]].forEach(([x, y, r]) => { g.fillStyle = '#2f5a3a'; g.beginPath(); g.ellipse(x, y, r * 1.3, r, 0, 0, TAU); g.fill(); });
    // 麦田：远处横带 → 近处竖向；风吹过的亮暗波
    const fg = g.createLinearGradient(0, HZ, 0, H); fg.addColorStop(0, '#c9a03a'); fg.addColorStop(0.35, C.wheat); fg.addColorStop(1, '#d69a28'); g.fillStyle = fg; g.fillRect(0, HZ, W, H - HZ);
    for (let y = HZ + 6; y < H; y += 10) for (let x = 0; x < W; x += 30) { const w = wind(x, y, t); if (w > 0.35) { g.fillStyle = `rgba(255,236,140,${(w - 0.35) * 0.9})`; g.fillRect(x, y, 30, 10); } else if (w < -0.4) { g.fillStyle = `rgba(150,96,20,${(-w - 0.4) * 0.8})`; g.fillRect(x, y, 30, 10); } }
    // 卡尔身边被分开的麦（暗槽）
    { const gg = g.createRadialGradient(cx, 960, 10, cx, 960, 150); gg.addColorStop(0, 'rgba(120,80,20,.55)'); gg.addColorStop(1, 'rgba(120,80,20,0)'); g.fillStyle = gg; g.fillRect(cx - 160, 800, 320, 280); }
    // 罂粟
    const r = U.rng(31); for (let i = 0; i < 60; i++) { const x = r() * W, y = HZ + 140 + r() * (H - HZ - 140); g.fillStyle = C.poppy; g.beginPath(); g.arc(x, y, 5 + r() * 6, 0, TAU); g.fill(); }
    // 柏树（火焰形，随风摆）
    const sw = Math.sin(t * 1.8) * 14;
    g.fillStyle = C.cypress; g.beginPath(); g.moveTo(CYP[0] - 62, CYP[1]); g.bezierCurveTo(CYP[0] - 96, 400, CYP[0] - 30 + sw * 0.5, 230, CYP[0] + sw, 70); g.bezierCurveTo(CYP[0] + 40 + sw * 0.5, 230, CYP[0] + 98, 400, CYP[0] + 64, CYP[1]); g.closePath(); g.fill();
    g.fillStyle = C.cypress2; g.beginPath(); g.moveTo(CYP[0] + 10, CYP[1] - 20); g.bezierCurveTo(CYP[0] + 60, 420, CYP[0] + 20 + sw * 0.5, 260, CYP[0] + sw, 110); g.bezierCurveTo(CYP[0] + 40, 300, CYP[0] + 70, 420, CYP[0] + 46, CYP[1] - 20); g.closePath(); g.fill();
  }
  const cypHalf = y => y < 70 ? 0 : 10 + 66 * Math.pow(clamp((y - 70) / (CYP[1] - 70)), 0.55) * (1 - 0.25 * clamp((y - 470) / 110));
  const inCyp = (x, y) => y > 60 && y < CYP[1] + 10 && Math.abs(x - CYP[0]) < cypHalf(y) + 12;
  const angle = (x, y, t, cx) => {
    if (inCyp(x, y)) return -Math.PI / 2 + 0.35 * Math.sin(y * 0.03 - t * 4) + 0.12 * Math.sin(t * 1.8);           // 柏树：火焰竖笔
    if (y < HZ - 40) {
      const dS = Math.hypot(x - SUN[0], y - SUN[1]); if (dS < 160) return Math.atan2(y - SUN[1], x - SUN[0]) + Math.PI / 2;   // 太阳：圆周
      let best = null, bd = 1e9; swirls.forEach(s => { const d = Math.hypot((x - s[0]) / 1.25, (y - s[1]) / 0.62) / s[2]; if (d < bd) { bd = d; best = s; } });
      if (bd < 1.5) return Math.atan2((y - best[1]) / 0.62, (x - best[0]) / 1.25) + Math.PI / 2 * best[3] + t * 0.3 * best[3];
      return 0.18 * Math.sin(x * 0.01 + y * 0.02 + t * 0.6);                                                       // 其余天空：横向长笔
    }
    if (y < HZ + 20) return 0.05 * Math.sin(x * 0.02);
    const depth = clamp((y - HZ) / (H - HZ));                                                                        // 远横近竖
    let a = lerp(-0.15, -Math.PI / 2, Math.pow(depth, 0.6)) + wind(x, y, t) * (0.25 + 0.45 * depth);
    const d = x - cx; if (y > 700) a += Math.sign(d) * 0.75 * Math.exp(-((d / 85) ** 2)) * depth;                     // 身边的麦向两侧分开
    return a;
  };
  const SW = {
    sky: P.swatch(['#22339a', '#2f4fb8', '#5c86dc', '#8fb6ee', '#3c6bd0', '#4f7fd8', '#a8c4f2'], 0.45),
    cloud: P.swatch(['#eef2fa', '#c8d8f4', '#fdfbe8', '#a8c0ec', '#dce6f8'], 0.35),
    sun: P.swatch(['#fff2a0', '#f6d84a', '#ffe680', '#f0c040'], 0.3),
    hill: P.swatch(['#3d5fa8', '#5a6fc0', '#2f5a6a', '#6a8fd0', '#4f8a6a'], 0.4),
    wheat: P.swatch(['#f2c13a', '#e0a020', '#f8d860', '#d08a18', '#c8b040', '#f6e08a', '#b87a18'], 0.25),
    cyp: P.swatch(['#1f4a2c', '#2f6a3a', '#173a24', '#3f7a48', '#24405a'], 0.35),
  };
  const palette = (x, y, col, r) => {
    if (inCyp(x, y) && col[1] < 130 && col[0] < 90) return SW.cyp(col, r);
    if (y < HZ - 60) { if (Math.hypot(x - SUN[0], y - SUN[1]) < 110) return SW.sun(col, r); const L = col[0] + col[1] + col[2]; return L > 560 ? SW.cloud(col, r) : SW.sky(col, r); }
    if (y < HZ + 14) return SW.hill(col, r);
    if (col[0] > 180 && col[1] < 110) return null;                                                                  // 罂粟保留红
    return SW.wheat(col, r);
  };
  const pal = { ...RIG.CARL_PAL, line: C.line, tee: '#f2efe2', teeShade: '#c8cde6', pants: '#2b3a7a', skin: '#f6d6bc', hair: '#141830', shoe: '#2a1e1a' };

  return {
    draw(c, lt, t) {
      const k = carlAt(t);
      const b = P.scratch('s23Base'), bg = b.getContext('2d'); bg.clearRect(0, 0, W, H); base(bg, t, k.x);
      c.drawImage(b, 0, 0);
      const A = (x, y, tt) => angle(x, y, tt, k.x);
      P.strokes(c, b, { cell: 12, len: 46, width: 8, angle: A, seed: 31, t, boil: 0, outline: 0.85, outlineMix: 0.42, palette, mask: (x, y) => y < HZ - 40 && !inCyp(x, y) });
      P.strokes(c, b, { cell: 9, len: 22, width: 6.5, angle: A, seed: 32, t, boil: 0, outline: 0.85, outlineMix: 0.42, palette, mask: (x, y) => y >= HZ - 60 && y < HZ + 24 && !inCyp(x, y) });
      P.strokes(c, b, { cell: 11, len: 34, width: 7, angle: A, seed: 33, t, boil: 0, outline: 0.85, outlineMix: 0.45, palette, mask: (x, y) => y >= HZ + 20 && !inCyp(x, y) });
      P.strokes(c, b, { cell: 8, len: 30, width: 7, angle: A, seed: 34, t, boil: 0, outline: 0.8, outlineMix: 0.5, palette, mask: inCyp });
      // 太阳光晕：一圈圈向外脉动（同 A 的灯晕语法）
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      for (let j = 0; j < 3; j++) { const ph = ((t * 0.8 + j / 3) % 1), r = 60 + ph * 120; c.strokeStyle = `rgba(255,236,140,${0.26 * (1 - ph)})`; c.lineWidth = 18; c.setLineDash([24, 14]); c.lineDashOffset = -t * 50; c.beginPath(); c.arc(SUN[0], SUN[1], r, 0, TAU); c.stroke(); }
      c.setLineDash([]); c.restore();
      { const sd = P.boilSeed(t, 8), sw = Math.sin(t * 1.8) * 14; c.save(); c.strokeStyle = C.line; c.lineWidth = 4.5; c.lineJoin = 'round';
        const cyp = []; for (let y = CYP[1]; y >= 72; y -= 18) cyp.push([CYP[0] - cypHalf(y) + sw * (1 - y / CYP[1]), y]); for (let y = 72; y <= CYP[1]; y += 18) cyp.push([CYP[0] + cypHalf(y) + sw * (1 - y / CYP[1]), y]);
        P.roughPath(c, cyp, { amp: 2.2, seed: sd * 31 + 7, closed: false, step: 14 }); c.stroke();
        const hz = []; for (let x = 0; x <= W; x += 40) hz.push([x, HZ + 4 + 3 * Math.sin(x * 0.01)]); P.roughPath(c, hz, { amp: 2, seed: sd * 31 + 9, step: 16 }); c.stroke(); c.restore(); }
      // 卡尔：平涂 → 细笔触 → 可见轮廓 → 眼镜与五官
      const G = RIG.carl(k);
      const L = P.scratch('s23Carl'), lg = L.getContext('2d'); lg.clearRect(0, 0, W, H);
      RIG.drawCarl(lg, G, { ...pal, mode: 'fill', lw: 0, features: () => {}, glasses: () => {} });
      lg.save(); lg.globalCompositeOperation = 'source-atop';
      P.strokes(lg, L, { cell: 7, len: 15, width: 4.6, seed: 35, t, boil: 0, outline: 0, jitterCol: 24, alphaMask: true,
        angle: (x, y) => y < G.A.neck[1] ? Math.atan2(y - G.A.headTop[1], x - G.A.headTop[0]) + 0.1 : -Math.PI / 2 + 0.25 * Math.sin(y * 0.03),
        palette: (x, y, col, r) => { const L_ = col[0] + col[1] + col[2]; if (L_ > 640) return P.mix(P.hex(['#fbf6e4', '#dfe6f8', '#c8d4f2', '#f6e8b0', '#eef0f6'][(r() * 5) | 0]), col, 0.3);
          if (col[2] > col[0] + 40) return P.mix(P.hex(['#2b3a7a', '#3c56a8', '#1c2a60', '#4a6ac0'][(r() * 4) | 0]), col, 0.35); return null; } });
      lg.restore();
      c.drawImage(L, 0, 0);
      c.drawImage(RIG.visibleLines('s23Carl', (g, lc) => RIG.drawCarl(g, G, { ...pal, line: lc, lw: 4, hairLine: null, features: () => {}, glasses: () => {} }), C.line, [k.x - 200, 240, k.x + 220, 1000]), 0, 0);
      RIG.drawCarlFeatures(c, G, { ...pal, featureLine: C.line, cheek: null }, 1.1);
      RIG.drawCarlGlasses(c, G, { ...pal, rim: '#141830' }, 1);
      // 前景麦穗：压在腿前，中间分开一道缝（缝随卡尔走）
      P.strokes(c, b, { cell: 10, len: 38, width: 7, angle: A, seed: 36, t, boil: 0, outline: 0.85, outlineMix: 0.45, palette,
        mask: (x, y) => { const d = x - k.x; return y > 820 + 26 * Math.sin(x * 0.05) && Math.abs(d) < 320 && !(Math.abs(d) < 34 * Math.exp(-(y - 820) / 300) + 12 && y < 900); } });
      // 前景麦穗头：随风点头的穗（短粗金色笔）
      const r = U.rng(5); c.save(); c.lineCap = 'round';
      for (let i = 0; i < 90; i++) { const bx = r() * W, by = 880 + r() * 200, d = bx - k.x; const lean = wind(bx, by, t) * 0.5 + Math.sign(d) * 0.7 * Math.exp(-((d / 90) ** 2));
        const tx = bx + Math.sin(lean) * 46, ty = by - Math.cos(lean) * 46; c.strokeStyle = '#7a5a10'; c.lineWidth = 3; c.beginPath(); c.moveTo(bx, by + 40); c.lineTo(tx, ty); c.stroke();
        c.strokeStyle = r() < .5 ? '#f6d860' : '#e0a020'; c.lineWidth = 9; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + Math.sin(lean) * 22, ty - Math.cos(lean) * 22); c.stroke(); }
      c.restore();
    },
  };
})();
