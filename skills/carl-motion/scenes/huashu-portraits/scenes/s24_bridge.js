// S24 莫奈印象派 B：卡尔走过睡莲池上的绿色拱桥，树影与碎光斑掠过衣服；6–8 s 停步、手扶栏杆、低头看水。
// 管线照 upstream/28_monet.js：①平涂底稿 → ②分区流场笔触（水面横笔、树丛短乱笔、桥单独细笔）＋区域色板
//   → ③角色平涂＋source-atop 细笔触＋色彩阴影（暖光冷影）→ ④只补五官（不勾外轮廓）→ ⑤水面光斑颤动、涟漪、紫藤摆动
SCENES['s24_bridge'] = (() => {
  const W = 1920, H = 1080, TAU = Math.PI * 2, { clamp, lerp, ss } = U, P = PAINT;
  const deckY = x => { const q = (x - 960) / 860; return 900 - 150 * (1 - q * q); };          // 桥面
  const RAIL = 215;                                                                             // 栏杆高
  const r0 = U.rng(2424), PADS = [];
  for (let i = 0; i < 70; i++) { const y = 470 + Math.pow(r0(), 0.8) * 600; PADS.push({ x: r0() * 2100 - 90, y, rx: (30 + r0() * 34) * (0.5 + (y - 470) / 600), ry: (8 + r0() * 6) * (0.5 + (y - 470) / 600), notch: r0() * TAU, flower: r0() < 0.35, ph: r0() * TAU, k: i }); }
  const pad = (p, t) => [p.x + Math.sin(t * 1.1 + p.ph) * 6 + t * 5, p.y + Math.sin(t * 1.7 + p.ph * 1.3) * 2];

  // ---- 卡尔走位 ----
  const CYCLE = 2.3, SPEED = 170;
  const ampAt = t => ss(0.0, 0.35, t) * (1 - ss(5.5, 6.2, t));
  const Wt = (() => { const n = 2401, a = new Float64Array(n); for (let i = 1; i < n; i++) a[i] = a[i - 1] + ampAt((i - 0.5) / 300) / 300; return t => a[clamp(Math.round(t * 300), 0, n - 1)]; })();
  const carlAt = t => {
    const x = 150 + SPEED * Wt(t), look = ss(6.1, 6.9, t);
    const slope = Math.atan2(deckY(x + 10) - deckY(x - 10), 20);
    const o = { x, y: deckY(x) + 4, s: 1.12, dir: 1, amp: ampAt(t), phase: TAU * Wt(t) / CYCLE, lean: slope * 0.5 + 0.08 * look,
      turn: 0.45 * look, tilt: 0.2 * look, smile: 0.85, blink: (t > 3.4 && t < 3.52) };
    if (look > 0) { const hx = 150 * look, hy = -260 + 30 * Math.sin(t * 2) * 0; o.armN = { t: [lerp(30, 110, look), lerp(-180, -205, look) + 3 * Math.sin(t * 2.4)], bend: -1 }; }
    return o;
  };

  function base(g, t) {
    // 池水：上浅下深，紫蓝绿；天光倒影
    const wg = g.createLinearGradient(0, 0, 0, H); wg.addColorStop(0, '#b9c7e6'); wg.addColorStop(0.4, '#94acd8'); wg.addColorStop(0.8, '#6f88c0'); wg.addColorStop(1, '#5a72a8');
    g.fillStyle = wg; g.fillRect(0, 0, W, H);
    [[1250, 560, 300, 50], [520, 700, 260, 46], [1560, 900, 240, 40], [300, 980, 220, 36]].forEach(([x, y, rx, ry], k) => { g.fillStyle = k % 2 ? '#e8d6e8' : '#f2e2c4'; g.beginPath(); g.ellipse(x + Math.sin(t * 0.8 + k) * 10, y, rx, ry, 0, 0, TAU); g.fill(); });
    // 桥的倒影（绿色弧，随波颤）
    g.strokeStyle = '#4f8a6a'; g.lineWidth = 16; g.beginPath(); for (let x = 60; x <= 1860; x += 10) { const y = 2 * 900 - deckY(x) + 30 + Math.sin(x * 0.05 + t * 5) * 4; x === 60 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    // 睡莲
    PADS.forEach(p => { const [x, y] = pad(p, t); g.fillStyle = p.k % 2 ? '#5f8f4a' : '#7aa85a'; g.beginPath(); g.ellipse(x, y, p.rx, p.ry, 0, p.notch + 0.35, p.notch + TAU - 0.35); g.lineTo(x, y); g.closePath(); g.fill();
      if (p.flower) { g.fillStyle = p.k % 3 ? '#f2a6bf' : '#fbf4f0'; g.beginPath(); g.ellipse(x + 5, y - 6, p.rx * 0.36, p.ry * 0.8, 0, 0, TAU); g.fill(); g.fillStyle = '#fff2e0'; g.beginPath(); g.ellipse(x + 5, y - 9, p.rx * 0.16, p.ry * 0.4, 0, 0, TAU); g.fill(); } });
    // 上方树丛（柳＋紫藤），下缘不齐
    for (let i = 0; i < 90; i++) { const r = U.rng(i * 13 + 5), x = r() * W, y = r() * 330 + (i % 3) * 20; g.fillStyle = ['#4f8a3a', '#6fa040', '#3f6a58', '#9cbf58', '#557a4a', '#6a8f5a'][i % 6]; g.beginPath(); g.ellipse(x, y, 60 + r() * 70, 40 + r() * 46, 0, 0, TAU); g.fill(); }
    // 柳条：竖向，随风横摆
    [[120, 1], [300, 0.8], [1640, 0.9], [1820, 1]].forEach(([x0, a], k) => { g.fillStyle = k % 2 ? '#557a4a' : '#4f6f8f';
      g.beginPath(); for (let y = 0; y <= 520; y += 20) g.lineTo(x0 + Math.sin(y * 0.025 - t * 2.6 + k) * 16 * (y / 520), y);
      for (let y = 520; y >= 0; y -= 20) g.lineTo(x0 + 40 * a + Math.sin(y * 0.025 - t * 2.6 + k + 0.5) * 16 * (y / 520), y); g.closePath(); g.fill(); });
    // 远岸：一条蓝绿花丛带
    g.fillStyle = '#6f9a7a'; g.beginPath(); g.moveTo(0, 470); for (let x = 0; x <= W; x += 30) g.lineTo(x, 440 + 18 * Math.sin(x * 0.012) + 10 * Math.sin(x * 0.041)); g.lineTo(W, 490); g.lineTo(0, 490); g.closePath(); g.fill();
    for (let i = 0; i < 40; i++) { const r = U.rng(i * 7 + 99), x = r() * W, y = 430 + r() * 50; g.fillStyle = ['#f0a0b8', '#f6e08a', '#d6c0ee', '#fbf4f0'][i % 4]; g.beginPath(); g.ellipse(x, y, 10 + r() * 10, 6, 0, 0, TAU); g.fill(); }
  }
  // 远侧栏杆（在卡尔后面）、桥面、近侧栏杆（在卡尔前面）
  function bridgeBack(g) {
    g.lineCap = 'round';
    g.strokeStyle = '#3f8a62'; g.lineWidth = 9; g.beginPath(); for (let x = 70; x <= 1850; x += 8) { const y = deckY(x) - RAIL - 18; x === 70 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    g.lineWidth = 6; for (let x = 100; x <= 1820; x += 64) { g.beginPath(); g.moveTo(x + 14, deckY(x) - 18); g.lineTo(x + 14, deckY(x) - RAIL - 18); g.stroke(); }
  }
  function bridgeDeck(g) {
    g.fillStyle = '#2f6a4a'; g.beginPath(); for (let x = 40; x <= 1880; x += 8) g.lineTo(x, deckY(x) - 6); for (let x = 1880; x >= 40; x -= 8) g.lineTo(x, deckY(x) + 34); g.closePath(); g.fill();
    g.fillStyle = '#7fcf9a'; g.beginPath(); for (let x = 40; x <= 1880; x += 8) g.lineTo(x, deckY(x) - 6); for (let x = 1880; x >= 40; x -= 8) g.lineTo(x, deckY(x) + 6); g.closePath(); g.fill();
    // 桥墩
    g.fillStyle = '#3f7a5a'; [[110, 70], [1810, 70]].forEach(([x, w]) => g.fillRect(x - w / 2, deckY(x) + 20, w, H));
  }
  function bridgeFront(g, t) {
    g.lineCap = 'round';
    g.strokeStyle = '#8fdcae'; g.lineWidth = 14; g.beginPath(); for (let x = 50; x <= 1870; x += 8) { const y = deckY(x) - RAIL; x === 50 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    g.strokeStyle = '#5fae84'; g.lineWidth = 8; g.beginPath(); for (let x = 50; x <= 1870; x += 8) { const y = deckY(x) - RAIL * 0.52; x === 50 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    g.strokeStyle = '#7fcf9a'; g.lineWidth = 9; for (let x = 70; x <= 1860; x += 64) { g.beginPath(); g.moveTo(x, deckY(x) + 4); g.lineTo(x, deckY(x) - RAIL); g.stroke(); }
    // 紫藤从栏杆垂下（摆动）
    for (let i = 0; i < 26; i++) { const x = 90 + i * 70, sw = Math.sin(t * 2.2 + i * 0.9) * 7, L = 30 + (i * 37 % 46), y0 = deckY(x) - RAIL; if (i % 3 === 1) continue;
      for (let j = 0; j < 8; j++) { const q = j / 7, px = x + sw * q * q + Math.sin(j * 2.1 + i) * 4, py = y0 + 8 + L * q * 1.2; g.fillStyle = ['#b8a0dc', '#d6c0ee', '#9a86c8', '#e8dcf6'][(i + j) % 4]; g.beginPath(); g.ellipse(px, py, 8 * (1 - q * 0.6), 6 * (1 - q * 0.5), 0.3, 0, TAU); g.fill(); } }
  }
  const isFoliage = (x, y) => y < 360 + 40 * Math.sin(x * 0.01);
  const angle = (x, y, t) => {
    if (isFoliage(x, y)) return -1.1 + 0.9 * P.noise(x * 0.02, y * 0.02 + t * 0.3);
    if (y > 420 && y < 495) return 0.1 * P.noise(x * 0.02, y * 0.02);
    return 0.06 * Math.sin(y * 0.05 + x * 0.004 + t * 0.6) + 0.05 * P.noise(x * 0.01, y * 0.01);                // 水面：横笔
  };
  const SW = {
    water: P.swatch(['#5b6fb5', '#7d8fd0', '#9db5e0', '#6aa0a8', '#b7a6d8', '#d9c8e8', '#8fb8a8', '#a6c4e8', '#c8b0d8'], 0.45),
    green: P.swatch(['#5f8f4a', '#7fae5a', '#3f6f4a', '#9cc070', '#6f9a7a', '#b4cc78'], 0.4),
    pink: P.swatch(['#f0a0b8', '#f7d0dc', '#fff2f4', '#e88aa0'], 0.3),
    leaf: P.swatch(['#4f7f3a', '#6f9a40', '#2f5a30', '#9cbf58', '#c0d070', '#3a6a5a', '#b8a0dc', '#e8d888'], 0.35),
  };
  const palette = (x, y, col, r) => {
    const [R, G, B] = col;
    if (isFoliage(x, y)) return SW.leaf(col, r);
    if (R > 200 && G < 190) return SW.pink(col, r);
    if (G > R + 15 && G > B - 10) return SW.green(col, r);
    return SW.water(col, r);
  };
  // 移动的树影（冷紫）与碎光斑（暖金）：叶隙光随风横移
  const dapple = (g, t, x0, y0, x1, y1, shadeA, lightA) => {
    const r = U.rng(808);
    for (let i = 0; i < 140; i++) { const bx = r() * 2400 - 240, by = y0 + r() * (y1 - y0), rr = 14 + r() * 34, sp = 50 + r() * 40;
      const x = ((bx + t * sp) % 2400 + 2400) % 2400 - 240; if (x < x0 - rr || x > x1 + rr) continue;
      const y = by + Math.sin(t * 2 + i) * 6, col = i % 3 ? [104, 92, 182, shadeA] : [255, 232, 160, lightA];
      const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${col[3]})`); gr.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},${col[3] * 0.7})`); gr.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr, rr * 0.7, 0.3, 0, TAU); g.fill(); }
  };
  const fill = { skin: '#f6d8c4', hair: '#3a3456', tee: '#f6f2ec', teeShade: '#dcd8ee', pants: '#6a6aa8', shoe: '#5a4f7a', cheek: null };

  return {
    draw(c, lt, t) {
      const k = carlAt(t);
      const b = P.scratch('s24Base'), bg = b.getContext('2d'); bg.clearRect(0, 0, W, H); base(bg, t);
      c.fillStyle = '#e8e0ec'; c.fillRect(0, 0, W, H); c.drawImage(b, 0, 0);
      P.strokes(c, b, { cell: 9, len: 34, width: 6.5, angle, seed: 41, t, boil: 6, outline: 0, jitterCol: 14, palette, mask: (x, y) => !isFoliage(x, y) });
      P.strokes(c, b, { cell: 7, len: 16, width: 5, angle, seed: 42, t, boil: 6, outline: 0, jitterCol: 16, palette, mask: isFoliage });
      // 水面光斑颤动（10fps 换位）＋涟漪（卡尔低头看的那片水）
      const st = Math.floor(t * 10); c.save(); c.lineCap = 'round';
      for (let i = 0; i < 170; i++) { const r = U.rng(i * 31 + 7), x = r() * W, y = 470 + r() * 600;
        const a = clamp(Math.sin(t * (5 + r() * 6) + r() * TAU) * Math.sin(t * 2.3 + i), 0, 1); if (a < 0.15) continue;
        const jx = (U.hash(i, st) - 0.5) * 10; c.strokeStyle = ['#fffbe8', '#fdf0d0', '#f8e0ec', '#e8f4ff'][i % 4]; c.globalAlpha = 0.85 * a; c.lineWidth = 4 + r() * 3;
        c.beginPath(); c.moveTo(x + jx, y); c.lineTo(x + jx + 14 + r() * 26, y + (r() - 0.5) * 3); c.stroke(); }
      const look = ss(6.1, 6.9, t);
      [[1150, 990, 0], [420, 1010, 0.4]].forEach(([x, y, k0], kk) => { for (let j = 0; j < 3; j++) { const q = (t * 0.8 + j / 3 + k0) % 1, amp = kk === 0 ? 0.35 + 0.65 * look : 0.6;
        c.globalAlpha = 0.6 * (1 - q) * amp; c.strokeStyle = '#eef4ff'; c.lineWidth = 3; c.setLineDash([12, 10]); c.beginPath(); c.ellipse(x, y, 24 + q * 120, (24 + q * 120) * 0.22, 0, 0, TAU); c.stroke(); } });
      c.setLineDash([]); c.globalAlpha = 1; c.restore();
      // 桥：远栏杆＋桥面（细笔）
      const Bp = P.scratch('s24Bridge'), bpg = Bp.getContext('2d'); bpg.clearRect(0, 0, W, H); bridgeBack(bpg); bridgeDeck(bpg);
      const bridgeStroke = (gg, cv) => { gg.save(); gg.globalCompositeOperation = 'source-atop';
        P.strokes(gg, cv, { cell: 5, len: 11, width: 4, seed: 43, t, boil: 0, outline: 0, alphaMask: true, angle: (x, y) => Math.atan2(deckY(x + 5) - deckY(x - 5), 10),
          palette: (x, y, col, r) => P.mix(P.hex(['#8fdcae', '#a8e8c0', '#6fc49a', '#c0f0d0', '#7fb8d8', '#4f9a7a'][(r() * 6) | 0]), col, 0.35) }); gg.restore(); };
      bridgeStroke(bpg, Bp); dapple(bpg, t, 0, 600, W, 900, 0.0, 0.0); c.drawImage(Bp, 0, 0);
      // 卡尔：平涂 → 细笔触 → 色彩阴影＋移动树影 → 五官细紫线
      const G = RIG.carl(k);
      const L = P.scratch('s24Carl'), lg = L.getContext('2d'); lg.clearRect(0, 0, W, H);
      RIG.drawCarl(lg, G, { ...fill, lw: 0, features: () => {}, glasses: () => {} });
      lg.save(); lg.globalCompositeOperation = 'source-atop';
      P.strokes(lg, L, { cell: 6, len: 12, width: 4.5, seed: 44, t, boil: 0, outline: 0, jitterCol: 18, alphaMask: true,
        angle: (x, y) => y < G.A.neck[1] ? Math.atan2(y - G.A.headTop[1], x - G.A.headTop[0]) + 0.2 : -Math.PI / 2 + 0.35 * Math.sin(y * 0.03),
        palette: (x, y, col, r) => { const L_ = col[0] + col[1] + col[2]; if (L_ > 690) return P.mix(P.hex(['#fbf8f2', '#e4e0f6', '#cfd2ee', '#f8ecd0', '#d8e8f2'][(r() * 5) | 0]), col, 0.25);
          if (L_ < 330) return P.mix(P.hex(['#3a3456', '#4a4a7a', '#2c2a48', '#5a5088'][(r() * 4) | 0]), col, 0.3); return null; } });
      const sg = lg.createLinearGradient(k.x - 120, 0, k.x + 160, 0); sg.addColorStop(0, 'rgba(110,100,190,0.28)'); sg.addColorStop(1, 'rgba(255,236,170,0.22)'); lg.fillStyle = sg; lg.fillRect(k.x - 240, 0, 480, H);
      dapple(lg, t, k.x - 220, 60, k.x + 240, 1000, 0.14, 0.36);
      lg.restore();
      c.drawImage(L, 0, 0);
      RIG.drawCarlFeatures(c, G, { ...RIG.CARL_PAL, featureLine: '#5a4f8a', iris: '#3a3a6a', lip: '#d8707a', browC: '#3a3456', cheek: null }, 0.9);
      RIG.drawCarlGlasses(c, G, { rim: '#2c2a48', lensGlint: true }, 0.9);
      // 近侧栏杆＋垂下的紫藤（压在卡尔前面）
      const Fr = P.scratch('s24Front'), fg = Fr.getContext('2d'); fg.clearRect(0, 0, W, H); bridgeFront(fg, t); bridgeStroke(fg, Fr); c.drawImage(Fr, 0, 0);
      // 手扶栏杆时把手重画在扶手上面
      if (k.armN) { c.fillStyle = '#f6d8c4'; c.fill(G.nearHand); }
    },
  };
})();
