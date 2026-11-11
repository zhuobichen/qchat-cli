// S22 古埃及壁画 B：卡尔沿壁画侧身迈步，圣甲虫推动太阳圆盘，河流水纹展开。
// 与少女与猫 A 同一画法：字形库、彩色几何边框、壁画表面（斑驳 multiply＋裂纹＋颗粒）、阿顿光线小手、圣甲虫画法
// 取自 upstream/02_egypt.js（huashu-art-motion，MIT，见 upstream/LICENSE_huashu）；构图、卡尔角色与 8 秒动作为本片新写。
// 0–2 s 建立卡尔与日盘、河带展开；2–5 s 卡尔侧步走、圣甲虫推盘；5–8 s 日盘滚进地平线山口升起，光线递安卡，卡尔举手致敬。
SCENES['s22_egypt'] = (() => {
  const W = 1920, H = 1080, { clamp, lerp } = U, P = PAINT;
  const C = {
    wall: '#eadcb8', wall2: '#d8c597', line: '#2a1810', rule: '#9a2b22',
    red: '#b8322a', blue: '#2a58a8', green: '#2e8a55', yellow: '#e2b13a', black: '#231a14',
    gold: '#e0ab38', goldD: '#a8741c', goldL: '#f3d27a', navy: '#1c2236', cream: '#f2ead6', white: '#f6f2e8',
    skin: '#e6b282', skinD: '#c98d5c', terra: '#d4936a', lapis: '#2c56b0', turq: '#3fa6a0',
    catO: '#e08a3c', catS: '#b45a1c', catW: '#f6efe0',
  };
  const BAND = [C.red, C.blue, C.yellow, C.green];        // 埃及边框四色

  // ---------------- 小工具 ----------------
  const poly = (g, pts, close = true) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (close) g.closePath(); };
  const fs = (g, fill, stroke, lw = 2.5) => { if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } };
  const sm = (pts, closed = true) => RIG.smooth(pts, closed);

  // ---------------- 象形文字字形库（原点居中，约 50px 宽；h = 占位高度） ----------------
  // 每个字形：{h, cols:[可选颜色], d(g) }；g 已设好 strokeStyle/fillStyle/lineWidth
  const GL = {
    ankh: { h: 60, cols: [C.blue, C.green, C.black, C.red], d(g) { g.lineWidth = 3.6; g.beginPath(); g.ellipse(0, -17, 8, 11, 0, 0, 7); g.moveTo(-16, -3); g.lineTo(16, -3); g.moveTo(0, -5); g.lineTo(0, 29); g.stroke(); } },
    sun: { h: 40, cols: [C.black, C.blue, C.red], d(g) { g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill(); } },
    bread: { h: 26, cols: [C.red, C.blue, C.green], d(g) { g.beginPath(); g.arc(0, 9, 19, Math.PI, 0); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-12, 4); g.lineTo(12, 4); g.stroke(); } },
    reed: { h: 62, cols: [C.black, C.green, C.red], d(g) { g.beginPath(); g.moveTo(-2, 29); g.quadraticCurveTo(-11, 0, 1, -29); g.quadraticCurveTo(7, -2, 4, 29); g.stroke(); g.beginPath(); g.moveTo(1, -29); g.quadraticCurveTo(9, -31, 10, -24); g.stroke(); } },
    owl: { h: 60, cols: [C.black, C.blue], d(g) { g.beginPath(); g.ellipse(3, 6, 12, 19, 0.1, 0, 7); g.stroke(); g.beginPath(); g.arc(-2, -18, 10, 0, 7); g.stroke(); g.beginPath(); g.arc(-6, -19, 2.4, 0, 7); g.arc(2, -19, 2.4, 0, 7); g.fill(); g.beginPath(); g.moveTo(-2, -14); g.lineTo(-3, -9); g.moveTo(9, 22); g.lineTo(18, 29); g.moveTo(-3, 24); g.lineTo(-5, 30); g.moveTo(4, 24); g.lineTo(3, 30); g.stroke(); } },
    falcon: { h: 60, cols: [C.black, C.red, C.blue], d(g) { g.beginPath(); g.arc(-6, -20, 7, 0, 7); g.fill(); poly(g, [[-12, -21], [-19, -16], [-11, -15]]); g.fill(); g.beginPath(); g.ellipse(2, 1, 10, 20, -0.35, 0, 7); g.stroke(); poly(g, [[8, 16], [20, 30], [6, 27]]); g.fill(); g.beginPath(); g.moveTo(-3, 19); g.lineTo(-5, 30); g.moveTo(2, 19); g.lineTo(1, 30); g.moveTo(-1, -8); g.quadraticCurveTo(10, 0, 12, 14); g.stroke(); } },
    heron: { h: 64, cols: [C.green, C.black, C.blue], d(g) { g.beginPath(); g.moveTo(-20, -22); g.lineTo(-8, -26); g.quadraticCurveTo(0, -28, -1, -18); g.quadraticCurveTo(-6, -8, 2, -2); g.stroke(); g.beginPath(); g.ellipse(8, 4, 13, 8, 0.4, 0, 7); g.stroke(); g.beginPath(); g.moveTo(4, 11); g.lineTo(2, 31); g.moveTo(10, 11); g.lineTo(12, 31); g.moveTo(18, 9); g.lineTo(24, 14); g.stroke(); } },
    snake: { h: 30, cols: [C.green, C.black, C.red], d(g) { g.lineWidth = 3.2; g.beginPath(); g.moveTo(22, 8); g.bezierCurveTo(10, -4, 4, 14, -6, 6); g.bezierCurveTo(-14, 0, -16, -4, -20, -2); g.stroke(); g.beginPath(); g.moveTo(-20, -2); g.lineTo(-23, -9); g.moveTo(-17, -3); g.lineTo(-15, -10); g.stroke(); } },
    eye: { h: 36, cols: [C.green, C.black, C.blue], d(g) { g.beginPath(); g.moveTo(-18, 0); g.quadraticCurveTo(0, -12, 18, 0); g.quadraticCurveTo(0, 9, -18, 0); g.stroke(); g.beginPath(); g.arc(0, -1, 4.5, 0, 7); g.fill(); g.beginPath(); g.moveTo(-18, -12); g.quadraticCurveTo(0, -20, 20, -11); g.moveTo(-4, 6); g.lineTo(-6, 16); g.moveTo(6, 5); g.quadraticCurveTo(14, 18, 4, 16); g.stroke(); } },
    cartouche: { h: 74, cols: [C.black, C.red], d(g) { g.beginPath(); g.ellipse(0, -2, 15, 31, 0, 0, 7); g.stroke(); g.beginPath(); g.moveTo(-14, 33); g.lineTo(14, 33); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(0, -18, 5, 0, 7); g.moveTo(-7, -2); g.lineTo(7, -2); g.moveTo(-6, 8); g.lineTo(-3, 13); g.lineTo(0, 8); g.lineTo(3, 13); g.lineTo(6, 8); g.stroke(); } },
    scarab: { h: 46, cols: [C.blue, C.black], d(g) { g.beginPath(); g.ellipse(0, 6, 10, 14, 0, 0, 7); g.fill(); g.beginPath(); g.arc(0, -11, 6, 0, 7); g.fill(); g.beginPath(); for (const s of [-1, 1]) for (const k of [-1, 0, 1]) { g.moveTo(s * 9, 6 + k * 8); g.lineTo(s * 17, 2 + k * 11); } g.stroke(); } },
    seated: { h: 58, cols: [C.red, C.black, C.blue], d(g) { g.beginPath(); g.arc(-2, -21, 6.5, 0, 7); g.fill(); poly(g, [[-6, -13], [4, -13], [6, 6], [16, 8], [17, 18], [-10, 18], [-10, 2]]); g.fill(); g.beginPath(); g.moveTo(-6, -8); g.lineTo(-17, -16); g.stroke(); g.beginPath(); g.moveTo(-14, 26); g.lineTo(18, 26); g.stroke(); } },
    leg: { h: 50, cols: [C.green, C.black, C.red], d(g) { poly(g, [[-3, -24], [6, -24], [6, 18], [16, 22], [16, 26], [-4, 26]]); g.stroke(); } },
    arm: { h: 24, cols: [C.black, C.red], d(g) { poly(g, [[-22, -4], [10, -4], [16, -8], [22, -6], [16, 2], [-22, 4]]); g.stroke(); } },
    basket: { h: 26, cols: [C.blue, C.green, C.black], d(g) { g.beginPath(); g.moveTo(-20, -4); g.lineTo(20, -4); g.quadraticCurveTo(18, 12, 0, 12); g.quadraticCurveTo(-18, 12, -20, -4); g.stroke(); g.beginPath(); g.arc(22, 2, 5, -1.5, 1.6); g.stroke(); } },
    house: { h: 36, cols: [C.black, C.red], d(g) { g.beginPath(); g.moveTo(-6, 14); g.lineTo(-18, 14); g.lineTo(-18, -14); g.lineTo(18, -14); g.lineTo(18, 14); g.lineTo(6, 14); g.stroke(); } },
    strokes: { h: 34, cols: [C.red, C.black], d(g) { g.beginPath(); for (const x of [-8, 0, 8]) { g.moveTo(x, -14); g.lineTo(x, 14); } g.stroke(); } },
    feather: { h: 60, cols: [C.blue, C.green, C.black], d(g) { g.beginPath(); g.moveTo(-2, 29); g.quadraticCurveTo(-8, -10, 4, -29); g.quadraticCurveTo(12, -18, 6, 0); g.quadraticCurveTo(3, 15, 2, 29); g.stroke(); } },
    djed: { h: 62, cols: [C.blue, C.green], d(g) { g.beginPath(); g.moveTo(-6, 29); g.lineTo(-6, -10); g.moveTo(6, 29); g.lineTo(6, -10); for (let k = 0; k < 4; k++) { g.moveTo(-13, -12 - k * 5); g.lineTo(13, -12 - k * 5); } g.moveTo(-12, 29); g.lineTo(12, 29); g.stroke(); } },
    shen: { h: 42, cols: [C.red, C.blue], d(g) { g.beginPath(); g.arc(0, -4, 13, 0, 7); g.stroke(); g.beginPath(); g.moveTo(-14, 13); g.lineTo(14, 13); g.stroke(); } },
    jug: { h: 50, cols: [C.red, C.green, C.blue], d(g) { g.beginPath(); g.moveTo(-6, -22); g.lineTo(6, -22); g.lineTo(5, -14); g.quadraticCurveTo(16, -6, 12, 12); g.quadraticCurveTo(8, 22, 0, 22); g.quadraticCurveTo(-8, 22, -12, 12); g.quadraticCurveTo(-16, -6, -5, -14); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-10, 0); g.lineTo(10, 0); g.stroke(); } },
    lotus: { h: 56, cols: [C.green, C.blue], d(g) { g.beginPath(); g.moveTo(0, 27); g.lineTo(0, -6); g.stroke(); poly(g, [[0, -6], [-12, -18], [-6, -26], [0, -16], [6, -26], [12, -18]]); g.stroke(); } },
    nfr: { h: 56, cols: [C.black, C.red], d(g) { g.beginPath(); g.ellipse(0, 12, 10, 14, 0, 0, 7); g.moveTo(0, -2); g.lineTo(0, -26); g.moveTo(-6, -18); g.lineTo(6, -18); g.moveTo(-6, -12); g.lineTo(6, -12); g.stroke(); } },
    mouth: { h: 20, cols: [C.red], d(g) { g.beginPath(); g.moveTo(-18, 0); g.quadraticCurveTo(0, -9, 18, 0); g.quadraticCurveTo(0, 9, -18, 0); g.stroke(); } },
    water: { h: 30, cols: [C.blue], water: true, d(g, ph = 0) { g.lineWidth = 2.6; for (let r = -1; r <= 1; r++) { g.beginPath(); for (let i = 0; i <= 16; i++) { const x = -21 + i * 2.625, y = r * 9 + ((i + ph) % 2 < 1 ? -3 : 3); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } } },
  };
  const GN = Object.keys(GL);

  // ---------------- 彩色几何边框 ----------------
  function blocks(g, x0, y0, x1, y1, len, off = 0) {      // 沿长边排彩块，块间米白细缝，外框黑线
    const hor = (x1 - x0) > (y1 - y0), L = hor ? x1 - x0 : y1 - y0;
    g.fillStyle = C.cream; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let s = 0, k = off; s < L; s += len, k++) {
      g.fillStyle = BAND[k % 4];
      if (hor) g.fillRect(x0 + s + 3, y0 + 3, Math.min(len - 6, L - s - 3), y1 - y0 - 6); else g.fillRect(x0 + 3, y0 + s + 3, x1 - x0 - 6, Math.min(len - 6, L - s - 3));
      g.fillStyle = C.black; if (hor) g.fillRect(x0 + s, y0, 2, y1 - y0); else g.fillRect(x0, y0 + s, x1 - x0, 2);
    }
    g.strokeStyle = C.black; g.lineWidth = 2; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // ---------------- 壁画表面：斑驳（multiply）＋裂纹＋颗粒 ----------------
  const surface = () => P.cached('eg_surface', W, H, (g) => {
    const img = g.createImageData(W, H), d = img.data, r = U.rng(99);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const n = P.fbm(x * 0.006 + 40, y * 0.006, 4), m = P.fbm(x * 0.03, y * 0.03 + 9, 2);
      const v = 243 + n * 30 + m * 12 + (r() - 0.5) * 18;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = ((y + dy) * W + x + dx) * 4; d[i] = v; d[i + 1] = v - 6; d[i + 2] = v - 16; d[i + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    // 发丝裂纹（墙面老化，跨过人物）
    const rr = U.rng(5);
    [[0, 610, 0.1], [700, 0, 1.3], [1210, 0, 1.1], [1500, 980, -0.9], [380, 1080, -1.2], [1920, 420, 2.9]].forEach(([x, y, a0]) => {
      g.strokeStyle = 'rgba(90,70,50,.55)'; g.lineWidth = 1.1; let a = a0;
      g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 34; s++) { a += (rr() - 0.5) * 0.7; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); if (rr() < 0.08) { g.moveTo(x, y); } } g.stroke();
    });
  });
  const specks = () => P.grain('eg_specks', 0.018, [70, 50, 30], 0.4);

  // ---------------- 阿顿光线：末端小手一张一合 ----------------
  const HANDS = [[444, 322], [436, 358], [428, 402], [440, 462], [446, 508], [492, 512], [538, 498], [612, 470], [680, 452], [712, 424], [732, 390], [746, 356], [748, 326]];
  function handAt(g, x, y, ang, open, col = '#b4452c') {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = col; g.strokeStyle = '#5a1c10'; g.lineWidth = 1.3;
    g.scale(1.35, 1.35);
    g.lineCap = 'round'; g.lineWidth = 4.2;
    g.scale(0.9 + 0.3 * open, 0.9 + 0.3 * open);
    for (let k = 0; k < 4; k++) { const a = (k - 1.5) * (0.03 + open * 0.42); g.beginPath(); g.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); g.lineTo(Math.cos(a) * (12.5 + open * 1.5), Math.sin(a) * (12.5 + open * 1.5)); g.strokeStyle = '#5a1c10'; g.lineWidth = 5.6; g.stroke(); g.strokeStyle = col; g.lineWidth = 3.4; g.stroke(); }
    g.beginPath(); g.moveTo(1, -5); g.lineTo(5, -10 - open * 3); g.strokeStyle = '#5a1c10'; g.lineWidth = 5.4; g.stroke(); g.strokeStyle = col; g.lineWidth = 3.2; g.stroke();
    g.beginPath(); g.ellipse(0, 0, 8, 6.6, 0, 0, 7); g.fillStyle = col; g.fill(); g.strokeStyle = '#5a1c10'; g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.moveTo(-9, 0); g.lineTo(-14, 0); g.strokeStyle = col; g.lineWidth = 4; g.stroke();       // 手腕
    g.restore();
  }
  const { ss } = U, TAU = Math.PI * 2, frac = v => v - Math.floor(v);

  // ---------------- 新构图：上栏（铭文横栏＋圣甲虫推日）／栏间彩带／下栏（卡尔）／河带 ----------------
  const GY = 404, DIV1 = 432, AKX = 1330, DR = 54;
  const GROUPS = [[[70, 140, 210, 280], 58, 392], [[1560, 1637, 1713, 1790, 1866], 58, 392], [[78, 154, 230], 446, 884], [[1712, 1789, 1866], 446, 884]];
  const GLYPHS = (() => {
    const r = U.rng(2022), out = [];
    GROUPS.forEach(([xs, y0, y1]) => { for (let k = 0; k < xs.length - 1; k++) {
      const used = {};
      const cx = (xs[k] + xs[k + 1]) / 2; let y = y0 + 8, prev = '';
      while (true) {
        let n; do { n = GN[(r() * GN.length) | 0]; } while (n === prev || used[n] > 2 || ((n === 'scarab' || n === 'water') && r() < 0.6)); prev = n; used[n] = (used[n] || 0) + 1;
        const gl = GL[n], s = (xs[k + 1] - xs[k]) / 78 * (1.0 + r() * 0.14);
        if (y + gl.h * s > y1) break;
        out.push({ n, x: cx + (r() - 0.5) * 4, y: y + gl.h * s / 2, s, col: gl.cols[(r() * gl.cols.length) | 0], ph: r() * 2 });
        y += gl.h * s + 6 + r() * 5;
      }
    } });
    let nw = out.filter(q => q.n === 'water').length;
    for (const q of out) { if (nw >= 6) break; if (['mouth', 'bread', 'basket', 'arm', 'strokes'].includes(q.n)) { q.n = 'water'; q.col = C.blue; nw++; } }
    return out;
  })();
  // 上栏横排铭文（62–154 两条红线之间）
  const ROW = (() => { const r = U.rng(1922), out = []; let x = 352, prev = '';
    while (x < 1500) { let n; do { n = GN[(r() * GN.length) | 0]; } while (n === prev || n === 'water'); prev = n;
      const s = 0.95, w = (['arm', 'basket', 'mouth', 'snake', 'heron', 'eye', 'bread'].includes(n) ? 52 : 36) * s;
      out.push({ n, x: x + w / 2, y: 108, s, col: GL[n].cols[(r() * GL[n].cols.length) | 0], ph: 0 }); x += w + 14; }
    return out; })();
  const ALL = GLYPHS.concat(ROW);
  const drawGlyph = (g, q, ph = 0, rv = 1) => { g.save(); g.translate(q.x, q.y); g.scale(q.s, q.s); g.strokeStyle = q.col; g.fillStyle = q.col; g.lineWidth = 3.1; g.lineCap = 'round'; g.lineJoin = 'round';
    if (rv < 1) { g.setLineDash([Math.max(0.01, rv * 95), 999]); if (rv < 0.55) g.fillStyle = 'rgba(0,0,0,0)'; }
    GL[q.n].d(g, ph); g.restore(); };
  // 铭文被逐个写出：同 A 的做法（擦掉→笔画揭示→亮金落回原色），本片放慢到每格 3 个
  const WRITERS = (() => { const r = U.rng(78), idx = ALL.map((q, i) => i).filter(i => !GL[ALL[i].n].water); for (let i = idx.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx; })();
  const WRITE_SLOT = 0.12, WRITE_DUR = 0.36, WRITE_N = 3;
  function writeGlyphs(c, lt) {
    const wall = P.texture('eg_wall', C.wall), s0 = Math.floor(lt / WRITE_SLOT);
    for (let s = Math.max(0, s0 - 2); s <= s0; s++) for (let m = 0; m < WRITE_N; m++) {
      const q = ALL[WRITERS[(s * WRITE_N + m) % WRITERS.length]], p = clamp((lt - s * WRITE_SLOT) / WRITE_DUR);
      if (p >= 1) continue;
      const w = 64 * q.s, h = (GL[q.n].h + 10) * q.s, x0 = q.x - w / 2, y0 = q.y - h / 2;
      c.drawImage(wall, x0, y0, w, h, x0, y0, w, h);
      const glow = 1 - p, col = P.rgb(P.mix(P.hex(q.col), [246, 200, 70], glow * 0.85));
      c.save(); c.shadowColor = `rgba(255,200,80,${0.9 * glow})`; c.shadowBlur = 10 * glow;
      drawGlyph(c, { ...q, col }, q.ph, Math.min(1, p * 1.35));
      c.restore();
    }
  }

  // ---------------- 静态层 ----------------
  function akhet(g) {          // 地平线符号：两座圆顶山，日盘落进山口
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(AKX + s * 132, GY); g.bezierCurveTo(AKX + s * 128, GY - 96, AKX + s * 36, GY - 96, AKX + s * 30, GY); g.closePath(); fs(g, '#c98a3e', C.line, 2.6);
      g.save(); g.clip(); g.strokeStyle = C.green; g.lineWidth = 7; g.beginPath(); g.moveTo(AKX + s * 124, GY - 8); g.bezierCurveTo(AKX + s * 120, GY - 84, AKX + s * 44, GY - 84, AKX + s * 38, GY - 8); g.stroke();
      g.fillStyle = 'rgba(90,40,10,.35)'; for (let k = 0; k < 14; k++) { const r = U.rng(k + (s > 0 ? 40 : 0)); g.beginPath(); g.arc(AKX + s * (48 + r() * 70), GY - 10 - r() * 50, 2.2, 0, 7); g.fill(); }
      g.restore();
    }
  }
  function staticLayer(g) {
    g.drawImage(P.texture('eg_wall', C.wall, { scale: 0.0035, amt: 16, grain: 12, dark: C.wall2, seed: 13 }), 0, 0);
    g.lineCap = 'round';
    GROUPS.forEach(([xs, y0, y1]) => xs.forEach(x => { g.strokeStyle = C.rule; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }));
    [62, 154].forEach(y => { g.strokeStyle = C.rule; g.lineWidth = 2.6; g.beginPath(); g.moveTo(330, y); g.lineTo(1530, y); g.stroke(); });
    ALL.forEach(q => { if (!GL[q.n].water) drawGlyph(g, q); });
    akhet(g);
    // 上栏地线＋栏间彩块饰带
    g.fillStyle = C.black; g.fillRect(0, GY, W, 3);
    blocks(g, -20, GY + 3, W + 20, DIV1 - 3, 64, 1);
    g.fillStyle = C.black; g.fillRect(0, DIV1 - 3, W, 3);
    // 下栏地线、河带底、黄红细带、深蓝带
    g.fillStyle = C.black; g.fillRect(0, 898, W, 6);
    g.fillStyle = C.cream; g.fillRect(0, 904, W, 102);
    g.fillStyle = C.yellow; g.fillRect(0, 1010, W, 13); g.fillStyle = C.red; g.fillRect(0, 1027, W, 10);
    g.fillStyle = C.black; [1006, 1008, 1023, 1037].forEach(y => g.fillRect(0, y, W, 1.6));
    g.fillStyle = C.navy; g.fillRect(0, 1039, W, 41);
    const r = U.rng(7); for (let i = 0; i < 1600; i++) { g.fillStyle = r() < 0.5 ? 'rgba(90,100,140,.35)' : 'rgba(5,8,20,.45)'; g.fillRect(r() * W, 1039 + r() * 41, 1 + r() * 2, 1 + r() * 2); }
    // 顶部与两侧彩色边框
    blocks(g, -10, 6, W + 10, 40, 56, 2);
    blocks(g, 32, 40, 58, 898, 46, 1); blocks(g, 1890, 40, 1916, 898, 46, 3);
  }

  // ---------------- 河带：0–2.6 s 从左向右展开，之后水纹持续流动（12fps 逐张） ----------------
  const FISH = [[200, 938, 70, 1], [900, 972, 104, 0.85], [1500, 952, 52, 1.1]];
  const LOTUS = [150, 420, 700, 980, 1260, 1540, 1800];
  function river(c, t) {
    const rev = W * (1 - Math.pow(1 - clamp(t / 2.6), 3));
    if (rev < 2) return;
    const tq = Math.floor(t * 12) / 12;
    c.save(); c.beginPath(); c.rect(0, 906, rev, 99); c.clip();
    c.fillStyle = '#3d6cbe'; c.fillRect(0, 906, W, 99);
    c.strokeStyle = '#12204a'; c.lineWidth = 2.6; c.lineJoin = 'miter';
    for (let row = 0; row < 4; row++) { const y = 922 + row * 23, off = (Math.floor(t * 12) * 3 + row * 6) % 24;
      c.beginPath(); for (let i = -2; i < W / 12 + 2; i++) { const x = i * 12 + off; i > -2 ? c.lineTo(x, y + (((i % 2) + 2) % 2 ? 5 : -5)) : c.moveTo(x, y); } c.stroke(); }
    // 罗非鱼（侧面、条纹），逐张前游
    FISH.forEach(([x0, y, v, s], k) => { const x = ((x0 + v * tq) % (W + 160) + W + 160) % (W + 160) - 80;
      c.save(); c.translate(x, y + Math.sin(tq * 3 + k) * 2); c.scale(s, s);
      poly(c, [[-26, 0], [-40, -10], [-38, 10]]); fs(c, '#6aa0b8', C.line, 2);
      c.beginPath(); c.ellipse(0, 0, 28, 13, 0, 0, 7); fs(c, '#9cc8d4', C.line, 2.2);
      c.save(); c.clip(); c.strokeStyle = '#3a6a8a'; c.lineWidth = 2; for (let q = -14; q <= 12; q += 7) { c.beginPath(); c.moveTo(q, -13); c.lineTo(q - 4, 13); c.stroke(); } c.restore();
      c.beginPath(); c.moveTo(-6, -12); c.quadraticCurveTo(6, -22, 16, -11); fs(c, '#6aa0b8', C.line, 1.6);
      c.fillStyle = C.line; c.beginPath(); c.arc(18, -3, 2.4, 0, 7); c.fill(); c.restore(); });
    c.restore();
    // 河面荷叶与蓝睡莲：随展开边缘逐个长出
    LOTUS.forEach((x, k) => { const g = clamp((rev - x) / 90); if (g <= 0) return; const sw = Math.sin(t * 1.6 + k) * 0.06;
      c.save(); c.translate(x, 906); c.scale(g, g);
      c.beginPath(); c.ellipse(-30, 2, 26, 6, 0, 0, 7); fs(c, C.green, C.line, 2);
      c.rotate(sw); c.strokeStyle = C.green; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 4); c.lineTo(0, -34); c.stroke();
      poly(c, [[0, -34], [-14, -48], [-7, -60], [0, -46], [7, -60], [14, -48]]); fs(c, k % 2 ? '#3a78c8' : C.blue, C.line, 2);
      c.restore(); });
    // 展开的卷边
    if (rev < W) { const g = c.createLinearGradient(rev - 30, 0, rev, 0); g.addColorStop(0, 'rgba(20,20,40,0)'); g.addColorStop(1, 'rgba(20,20,40,.35)');
      c.fillStyle = g; c.fillRect(rev - 30, 906, 30, 99); c.fillStyle = C.cream; c.fillRect(rev, 904, 8, 102); c.fillStyle = C.line; c.fillRect(rev + 8, 904, 2, 102); }
  }
  // 黄带上的短刻纹：装饰条持续向右走（12fps 逐张）
  function bandTicks(c, t) { const off = (Math.floor(t * 12) * 2) % 20; c.fillStyle = C.line;
    for (let x = off - 20; x < W; x += 20) c.fillRect(x, 1012, 3, 9); }

  // ---------------- 纸莎草丛（下栏右侧），逐张轻摆 ----------------
  const PAPY = (() => { const r = U.rng(512), out = []; for (let i = 0; i < 9; i++) out.push({ x: 1430 + i * 30 + r() * 16, h: 250 + r() * 110, a: (r() - 0.5) * 0.3, ph: r() * 6 }); return out; })();
  function papyrus(c, t) {
    const tq = Math.floor(t * 12) / 12;
    PAPY.forEach((p, k) => { const a = p.a + Math.sin(tq * 1.8 + p.ph) * 0.035, tx = p.x + Math.sin(a) * p.h, ty = 898 - Math.cos(a) * p.h;
      c.strokeStyle = C.line; c.lineWidth = 6; c.beginPath(); c.moveTo(p.x, 898); c.lineTo(tx, ty); c.stroke(); c.strokeStyle = C.green; c.lineWidth = 3.4; c.stroke();
      c.save(); c.translate(tx, ty); c.rotate(a);
      poly(c, [[0, 4], [-26, -40], [26, -40]]); fs(c, k % 3 ? C.green : '#3a9a60', C.line, 2.2);
      c.strokeStyle = '#1f6a40'; c.lineWidth = 1.4; for (let q = -18; q <= 18; q += 9) { c.beginPath(); c.moveTo(0, 0); c.lineTo(q, -38); c.stroke(); }
      c.fillStyle = C.yellow; for (let q = -22; q <= 22; q += 11) { c.beginPath(); c.arc(q, -42, 3, 0, 7); c.fill(); }
      c.restore(); });
  }

  // ---------------- 圣甲虫推日盘 → 日盘落进地平线山口并升起（阿顿光线） ----------------
  const diskAt = t => {
    const u = clamp((t - 1.9) / 3.8), e = u * u * (3 - 2 * u);
    let x = lerp(520, AKX, e);
    if (t > 5.7) x = AKX + 9 * Math.sin((t - 5.7) * 10) * Math.exp(-(t - 5.7) * 5);     // 到位后轻轻来回晃一下才停
    const rise = ss(5.9, 7.0, t);
    return { x, y: GY - DR - rise * 70, rot: (x - 520) / DR, rise };
  };
  function sunDisk(c, D, lt) {
    if (D.rise > 0) {        // 升起后日盘脉动光晕（同 A 的 0.45 s 周期）
      const pu = 0.5 + 0.5 * Math.sin(lt * TAU / 0.45);
      const hg = c.createRadialGradient(D.x, D.y, DR, D.x, D.y, DR + 40 + 26 * pu); hg.addColorStop(0, `rgba(255,180,80,${(0.5 * pu + 0.15) * D.rise})`); hg.addColorStop(1, 'rgba(255,170,70,0)');
      c.fillStyle = hg; c.beginPath(); c.arc(D.x, D.y, DR + 70, 0, 7); c.fill();
      c.beginPath(); c.arc(D.x, D.y, DR + 7 + 5 * pu, 0, 7); c.strokeStyle = `rgba(255,214,110,${0.75 * pu * D.rise})`; c.lineWidth = 5; c.stroke();
    }
    c.beginPath(); c.arc(D.x, D.y, DR, 0, 7); c.fillStyle = '#c8322a'; c.fill(); c.strokeStyle = '#5a140c'; c.lineWidth = 3; c.stroke();
    c.save(); c.clip(); c.globalAlpha = 1 - D.rise; c.fillStyle = '#f2c23a';          // 滚动时的黄点，升起后褪去
    for (let k = 0; k < 7; k++) { const a = D.rot + k * TAU / 7; c.beginPath(); c.arc(D.x + Math.cos(a) * 33, D.y + Math.sin(a) * 33, 6.5, 0, 7); c.fill(); }
    c.beginPath(); c.arc(D.x, D.y, 7, 0, 7); c.fill(); c.restore();
    c.beginPath(); c.arc(D.x, D.y, DR - 9, 0, 7); c.strokeStyle = 'rgba(255,200,150,.35)'; c.lineWidth = 2; c.stroke();
    if (D.rise > 0.3) { c.globalAlpha = clamp((D.rise - 0.3) / 0.4); c.fillStyle = C.gold; c.beginPath(); c.ellipse(D.x, D.y + DR - 6, 8, 11, 0, 0, 7); c.fill(); c.strokeStyle = C.black; c.lineWidth = 1.6; c.stroke(); c.globalAlpha = 1; }
  }
  function bigScarab(c, t, D) {
    const k = 2.0, push = t > 1.9 && t < 5.8, back = ss(5.9, 6.7, t);
    const sx = D.x - DR - 38 * k - back * 120, sy = GY - 31 * k;
    const pose = push ? Math.floor(t * 12) % 2 : Math.floor(t * 3) % 2;
    // 前足始终够着日盘左下缘（推→托）
    const cp = [D.x - DR * Math.cos(0.5 + 0.5 * back), D.y + DR * Math.sin(0.5 + 0.5 * back)];
    const toL = p => [(p[0] - sx) / k, (p[1] - sy) / k];
    c.save(); c.translate(sx, sy); c.scale(k, k); c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = '#141a30'; c.lineWidth = 3;
    const legs = pose ? [[-14, -16, -26], [0, -18, -6], [14, -14, 18]] : [[-14, -14, -32], [0, -19, 2], [14, -18, 24]];
    legs.forEach(([lx, ly, ex], i) => { for (const s of [-1, 1]) { const q = s * (i === 1 ? 1 : (pose ? 1 : -1)); c.beginPath(); c.moveTo(lx, 0); c.lineTo(lx + (ex - lx) * 0.5, s * (ly - 4)); c.lineTo(ex + q * 2, s * (ly + 4)); c.stroke(); } });
    const cl0 = toL(cp), cl = [lerp(cl0[0], 40, back), lerp(cl0[1], -14, back)];      // 退开后前足收回、举起 c.beginPath(); c.moveTo(26, -4); c.lineTo(cl[0], cl[1] - 4 + pose * 2); c.moveTo(26, 4); c.lineTo(cl[0] + 2, cl[1] + 4 - pose * 2); c.stroke();
    c.beginPath(); c.ellipse(-4, 0, 24, 17, 0, 0, 7); c.fillStyle = C.lapis; c.fill(); c.strokeStyle = '#0d1430'; c.lineWidth = 2.2; c.stroke();
    c.beginPath(); c.moveTo(-28, 0); c.lineTo(18, 0); c.stroke();
    c.fillStyle = C.turq; c.beginPath(); c.ellipse(-8, -8, 12, 4, -0.1, 0, 7); c.fill(); c.beginPath(); c.ellipse(-8, 8, 12, 4, 0.1, 0, 7); c.fill();
    c.beginPath(); c.ellipse(22, 0, 8, 11, 0, 0, 7); c.fillStyle = '#3a68c4'; c.fill(); c.strokeStyle = '#0d1430'; c.stroke();
    c.fillStyle = C.gold; c.beginPath(); c.arc(25, 0, 3, 0, 7); c.fill();
    c.restore();
  }
  // 阿顿光线：日盘升起后向下栏的卡尔展开，末端小手一张一合；对着卡尔脸的那一根递上安卡
  const RAYS = [0.95, 1.2, 1.45, 1.7, 1.95, 2.2];
  function aten(c, lt, t, D, face) {
    const g = ss(6.0, 7.1, t); if (g <= 0) return null;
    c.save(); c.lineCap = 'round';
    const draw = (ang, len, k) => { const ex = D.x + Math.cos(ang) * (DR + len * g), ey = D.y + Math.sin(ang) * (DR + len * g);
      const wob = Math.sin(t * 7 + k * 1.3) * 3, wx = ex + wob, wy = ey + Math.cos(t * 6 + k) * 2, a = Math.atan2(wy - D.y, wx - D.x);
      c.strokeStyle = '#c23a2a'; c.lineWidth = 3.2; c.beginPath(); c.moveTo(D.x + Math.cos(a) * (DR - 2), D.y + Math.sin(a) * (DR - 2)); c.lineTo(wx - Math.cos(a) * 7, wy - Math.sin(a) * 7); c.stroke();
      handAt(c, wx, wy, a, 0.5 + 0.5 * Math.sin(lt * TAU / 0.4 + k * 0.9)); return [wx, wy, a]; };
    RAYS.forEach((a, k) => draw(a, 190 + 80 * Math.abs(Math.sin(k * 1.7)), k));
    const fa = Math.atan2(face[1] - D.y, face[0] - D.x), fl = Math.hypot(face[0] - D.x, face[1] - D.y) - DR - 26;
    const end = draw(fa, fl, 9);
    c.restore();
    return end;
  }

  // ---------------- 卡尔：埃及程式（侧脸、正面眼、正面双肩、侧身腿）；外貌按用户提供的照片 ----------------
  // 黑色中分帘式刘海盖住耳朵到下颌、粗黑方框眼镜、露齿笑、米白圆领 T 恤；下身换成壁画里的白亚麻褶裙
  const CK = { skin: C.skin, skinD: C.skinD, hair: '#151418', strand: '#3c3a48', tee: '#f1eee4', teeLine: 'rgba(120,100,80,.45)', rim: '#111111' };
  const X0 = 330, X1 = 1000, LH = 52;
  const carlAt = t => {
    const u = clamp((t - 2.0) / 3.0), e = u * u * (3 - 2 * u), x = lerp(X0, X1, e);
    const blink = [1.3, 4.15, 7.25].some(b => t > b && t < b + 0.12);
    return { x, ph: (x - X0) / (4 * LH), walk: ss(1.9, 2.4, t) * (1 - ss(4.7, 5.15, t)), adore: ss(5.25, 6.05, t), blink, breathe: Math.sin(t * TAU / 2.6) };
  };
  function headCarl(c, st) {
    const L = C.line;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const face = RIG.smooth([[-8, -40], [16, -40], [27, -26], [29, -10], [30, 0], [33, 8], [42, 18], [34, 22], [36, 28], [31, 31], [34, 35], [30, 41], [26, 47], [16, 52], [2, 48], [-8, 34], [-12, 0]], true, 0.35);
    c.fillStyle = CK.skin; c.fill(face); c.strokeStyle = L; c.lineWidth = 2.6; c.stroke(face);
    // 露齿笑（侧面）：一小块白牙＋上翘嘴角
    poly(c, [[26, 29], [35.5, 28.5], [33, 33], [26.5, 32.5]]); fs(c, '#fbf7ee', L, 1.5);
    c.strokeStyle = L; c.lineWidth = 2; c.beginPath(); c.moveTo(20, 27); c.quadraticCurveTo(23, 32, 27, 32); c.stroke();
    c.lineWidth = 1.6; c.beginPath(); c.moveTo(33, 21); c.quadraticCurveTo(30, 23, 31, 20); c.stroke();          // 鼻翼
    c.strokeStyle = 'rgba(200,110,90,.45)'; c.lineWidth = 6; c.beginPath(); c.moveTo(12, 18); c.lineTo(20, 20); c.stroke();   // 颊色
    // 正面眼（杏仁形＋黑眼线），闭眼时一条弧
    const ex = 18, ey = -1;
    if (st.blink) { c.strokeStyle = L; c.lineWidth = 2.8; c.beginPath(); c.moveTo(ex - 9, ey); c.quadraticCurveTo(ex, ey + 4, ex + 10, ey); c.stroke(); }
    else { c.beginPath(); c.moveTo(ex - 9, ey); c.quadraticCurveTo(ex, ey - 8, ex + 10, ey - 1); c.quadraticCurveTo(ex, ey + 5, ex - 9, ey); c.closePath(); fs(c, '#fbf7ee', null);
      c.fillStyle = '#1a120c'; c.beginPath(); c.arc(ex + 1.5, ey - 1.5, 3.6, 0, 7); c.fill();
      c.strokeStyle = '#140c08'; c.lineWidth = 2.8; c.beginPath(); c.moveTo(ex - 10, ey); c.quadraticCurveTo(ex, ey - 9, ex + 10, ey - 1); c.stroke(); }
    // 头发：黑色中分帘式刘海＋盖耳的齐下颌长度
    const hair = RIG.smooth([[31, -11], [33, -30], [18, -50], [-10, -55], [-36, -43], [-49, -16], [-49, 14], [-45, 40], [-30, 49], [-12, 47], [-3, 30], [2, 8], [10, -5], [22, -12]], true, 0.45);
    c.fillStyle = CK.hair; c.fill(hair);
    c.save(); c.clip(hair); c.strokeStyle = CK.strand; c.lineWidth = 2.2;
    [[[16, -50], [-6, -30], [-34, 34]], [[4, -54], [-18, -34], [-42, 22]], [[22, -47], [28, -30], [27, -14]], [[10, -52], [8, -28], [4, 4]]].forEach(([a, b, d]) => { c.beginPath(); c.moveTo(...a); c.quadraticCurveTo(...b, ...d); c.stroke(); });
    c.restore();
    c.strokeStyle = L; c.lineWidth = 2.6; c.stroke(hair);
    // 粗黑方框眼镜（正面镜框配侧脸，同"正面眼"的程式）＋镜腿没入头发
    c.strokeStyle = CK.rim; c.lineWidth = 4.6; c.beginPath(); c.roundRect(5, -12, 29, 22, 4); c.stroke();
    c.lineWidth = 3.6; c.beginPath(); c.moveTo(5, -4); c.lineTo(-6, -2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(26, -8); c.lineTo(30, -5); c.stroke();
  }
  function carl(c, st) {
    const L = C.line, bob = -3 * st.walk * Math.cos(4 * Math.PI * st.ph), br = st.breathe * 1.4;
    const U_ = (x, y) => [x, y + bob + (y < -226 ? -br * (1 + (-226 - y) / 100) : 0)];       // 上半身随走路起伏＋呼吸
    c.save(); c.translate(st.x, 898); c.lineJoin = 'round'; c.lineCap = 'round';
    // 腿：远腿先画，脚平贴地（支撑相锁地，摆动相抬脚）
    const foot = k => { const p = frac(st.ph + k * 0.5); let off, lift = 0;
      if (p < 0.5) off = LH - 2 * LH * (p / 0.5); else { const u = (p - 0.5) / 0.5; off = -LH + 2 * LH * u * u * (3 - 2 * u); lift = 18 * Math.sin(Math.PI * u); }
      const rest = k ? -24 : 26; return [lerp(rest, off, st.walk), lift * st.walk]; };
    const F = [foot(0), foot(1)], hips = [U_(-4, -212), U_(6, -212)];
    [0, 1].forEach(k => { const [off, lift] = F[k], A = [off, -12 - lift], hp = hips[k];
      const { E } = RIG.ik2(hp, A, 104, 104, -1);
      const col = k ? CK.skin : CK.skinD;
      const th = RIG.taper(hp, E, 34, 26, 2), sh = RIG.taper(E, A, 25, 16, 2);
      c.fillStyle = col; c.strokeStyle = L; c.lineWidth = 2.4; c.fill(th); c.stroke(th); c.fill(sh); c.stroke(sh);
      const fp = RIG.smooth([[A[0] - 10, A[1] - 8], [A[0] - 13, A[1] + 5], [A[0] - 6, A[1] + 12], [A[0] + 34, A[1] + 12], [A[0] + 40, A[1] + 7], [A[0] + 28, A[1] + 1], [A[0] + 8, A[1] - 6]], true, 0.3);
      c.fillStyle = col; c.fill(fp); c.stroke(fp);
      c.strokeStyle = '#8a5a2a'; c.lineWidth = 3; c.beginPath(); c.moveTo(A[0] - 4, A[1] + 11); c.lineTo(A[0] + 36, A[1] + 11); c.stroke();   // 凉鞋底
    });
    // 手臂目标：走路摆臂 → 双手举向日盘（崇拜礼）
    const Sb = U_(-54, -312), Sf = U_(60, -312), sw = 0.42 * Math.sin(TAU * st.ph) * st.walk;
    const hang = (S, a) => [S[0] + Math.sin(a) * 164, S[1] + Math.cos(a) * 164];
    const tgtB = [lerp(hang(Sb, -sw - 0.06)[0], 92, st.adore), lerp(hang(Sb, -sw - 0.06)[1], -386 + bob, st.adore)];
    const tgtF = [lerp(hang(Sf, sw + 0.1)[0], 172, st.adore), lerp(hang(Sf, sw + 0.1)[1], -404 + bob, st.adore)];
    const arm = (S, T, far) => { const { E, H } = RIG.ik2(S, T, 86, 84, 1), col = far ? CK.skinD : CK.skin;
      const ua = RIG.taper(S, E, 30, 24, 2), fa = RIG.taper(E, H, 24, 17, 1);
      c.fillStyle = col; c.strokeStyle = L; c.lineWidth = 2.4; c.fill(ua); c.stroke(ua); c.fill(fa); c.stroke(fa);
      const sl = RIG.taper(S, [lerp(S[0], E[0], 0.48), lerp(S[1], E[1], 0.48)], 42, 34, 2); c.fillStyle = CK.tee; c.fill(sl); c.stroke(sl);
      const a = Math.atan2(H[1] - E[1], H[0] - E[0]); c.save(); c.translate(...H); c.rotate(a);
      const hp = RIG.smooth([[-4, -9], [14, -10], [24, -5], [24, 4], [12, 9], [-4, 8]], true, 0.4); c.fillStyle = col; c.fill(hp); c.stroke(hp);
      c.lineWidth = 2; c.beginPath(); c.moveTo(4, -9); c.lineTo(12, -17); c.stroke(); c.restore(); };
    arm(Sb, tgtB, true);
    // 褶裙（白亚麻、前片斜摆），随步幅略张
    const mx = Math.max(F[0][0], F[1][0]), mn = Math.min(F[0][0], F[1][0]);
    const kilt = [U_(-32, -228), U_(36, -228), [44 + 0.3 * Math.max(0, mx), -130 + bob], [-38 + 0.3 * Math.min(0, mn), -134 + bob]];
    poly(c, kilt); c.fillStyle = CK.skin; c.fill(); c.globalAlpha = 0.92; c.fillStyle = C.white; c.fill(); c.globalAlpha = 1;
    c.save(); poly(c, kilt); c.clip(); c.strokeStyle = 'rgba(120,96,70,.5)'; c.lineWidth = 1.3;
    for (let i = 0; i <= 14; i++) { const q = i / 14; c.beginPath(); c.moveTo(lerp(kilt[0][0], kilt[1][0], q), kilt[0][1]); c.lineTo(lerp(kilt[3][0], kilt[2][0], q * q), lerp(kilt[3][1], kilt[2][1], q)); c.stroke(); }
    c.restore(); poly(c, kilt); c.strokeStyle = L; c.lineWidth = 2.4; c.stroke();
    // 正面躯干：米白 T 恤
    const torso = RIG.smooth([[-12, -332], [-50, -324], [-62, -306], [-52, -280], [-34, -228], [36, -228], [56, -280], [66, -306], [56, -324], [16, -332]].map(p => U_(...p)), true, 0.35);
    c.fillStyle = CK.tee; c.fill(torso);
    c.save(); c.clip(torso); c.strokeStyle = CK.teeLine; c.lineWidth = 1.2; for (let x = -40; x <= 44; x += 12) { const a = U_(x, -300), b = U_(x * 0.7, -230); c.beginPath(); c.moveTo(...a); c.quadraticCurveTo(a[0] + 4, (a[1] + b[1]) / 2, ...b); c.stroke(); } c.restore();
    c.strokeStyle = L; c.lineWidth = 2.4; c.stroke(torso);
    // 腰带（红）＋垂带
    c.strokeStyle = C.red; c.lineWidth = 7; c.beginPath(); c.moveTo(...U_(-33, -228)); c.lineTo(...U_(37, -228)); c.stroke();
    c.lineWidth = 4; c.beginPath(); c.moveTo(...U_(20, -226)); c.lineTo(24, -186 + bob); c.stroke();
    // 颈＋圆领＋细珠项链（两道）
    const nk = [U_(-10, -366), U_(12, -360), U_(16, -330), U_(-12, -330)]; poly(c, nk); fs(c, CK.skin, L, 2.2);
    const nc = U_(2, -331);
    c.beginPath(); c.ellipse(nc[0], nc[1], 17, 7, 0, 0, Math.PI); c.strokeStyle = L; c.lineWidth = 2.2; c.stroke();
    [[C.blue, 24, 13], [C.red, 30, 18]].forEach(([col, rx, ry]) => { c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.ellipse(nc[0], nc[1], rx, ry, 0, 0.15, Math.PI - 0.15); c.stroke(); });
    // 头（随举手略仰）
    const hc = U_(4, -394);
    c.save(); c.translate(...hc); c.rotate(-0.07 * st.adore); c.scale(0.92, 0.92); headCarl(c, st); c.restore();
    arm(Sf, tgtF, false);
    c.restore();
    return [st.x + hc[0] + 40, 898 + hc[1] + 8];          // 鼻尖位置（世界坐标），给安卡光线瞄准
  }

  return {
    init() { P.cached('eg_static_b', W, H, staticLayer); surface(); specks(); },
    draw(c, lt, t) {
      c.drawImage(P.cached('eg_static_b', W, H, staticLayer), 0, 0);
      const wp = Math.floor(lt * 12) * 0.5;
      GLYPHS.forEach(q => { if (GL[q.n].water) drawGlyph(c, q, wp + q.ph); });
      writeGlyphs(c, lt);
      river(c, t); bandTicks(c, t);
      const D = diskAt(t), st = carlAt(t);
      const face = [st.x + 44, 898 - 386];
      const ray = aten(c, lt, t, D, face);
      sunDisk(c, D, lt);
      bigScarab(c, t, D);
      papyrus(c, t);
      carl(c, st);
      if (ray) { const [x, y, a] = ray; drawGlyph(c, { n: 'ankh', x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 18 + 4, s: 0.68, col: C.blue }); }
      // 壁画表面：斑驳 multiply ＋ 颗粒（同 A）
      c.save(); c.globalCompositeOperation = 'multiply'; c.drawImage(surface(), 0, 0); c.restore();
      c.drawImage(specks(), 0, 0);
    },
  };
})();
