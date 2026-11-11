// 卡尔简化卡通骨架（依卡尔本人照片提炼）：
//   识别点 = 黑色中分「窗帘刘海」长到下颌、盖住耳朵；粗黑方框眼镜；露齿笑；米白圆领 T 恤。
// 与 RIG.girl 同一约定：每个部位输出 Path2D，场景代码自己决定怎么画（平涂/笔触/剪影/橡皮管）。
// 局部坐标：脚底 y=0，向上为负，身高约 600；dir=1 朝右走，-1 朝左。
(() => {
const { clamp, lerp } = U;
const R = window.RIG;

const rrect = (p, cx, cy, w, h, r) => {
  const x = cx - w / 2, y = cy - h / 2; r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r); p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h); p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
};

// opt: x,y(脚底屏幕坐标) s dir phase amp(走路幅度0..1) turn(0=3/4朝前进方向,1=正对镜头) tilt(头低/抬，弧度)
//      armN/armF:{t:[lx,ly]} 局部坐标的手部目标（IK）  blink smile(0..1) lean(身体前倾弧度) squash(纵向压缩)
R.carl = (opt = {}) => {
  const { x = 960, y = 900, s = 1, dir = 1, phase = 0, amp = 0, turn = 0, tilt = 0, lean = 0, squash = 1 } = opt;
  // 世界坐标映射（含前倾：绕髋部旋转上身）
  const W = (lx, ly) => [x + dir * s * lx, y + s * ly * squash];
  const G = { dir, s, J: {} };

  // ---- 腿：先算两腿关节，再整体上下平移让较低的脚着地 ----
  const HIP_Y = -250, TH = 125, SH = 120;
  const leg = (k) => {
    const psi = phase + k * Math.PI;
    const th = amp * 0.46 * Math.sin(psi);
    const kn = amp * (0.1 + 0.85 * Math.pow(Math.max(0, Math.cos(psi)), 1.3));
    const hip = [k ? 9 : -6, HIP_Y];
    const knee = [hip[0] + Math.sin(th) * TH, hip[1] + Math.cos(th) * TH];
    const sa = th - kn;
    const ank = [knee[0] + Math.sin(sa) * SH, knee[1] + Math.cos(sa) * SH];
    const toeA = -0.25 * Math.max(0, Math.cos(psi)) * amp;
    return { hip, knee, ank, toeA };
  };
  const LN = leg(0), LF = leg(1);
  const drop = -Math.max(LN.ank[1], LF.ank[1]);               // 让最低的脚踩在 y=0
  const sh = (p) => [p[0], p[1] + drop];
  [LN, LF].forEach(L => { L.hip = sh(L.hip); L.knee = sh(L.knee); L.ank = sh(L.ank); });
  const hipC = [2, HIP_Y + drop];
  // 上身绕髋前倾
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const UB = (lx, ly) => { const dx = lx - hipC[0], dy = ly - hipC[1]; return W(hipC[0] + dx * cl - dy * sl, hipC[1] + dx * sl + dy * cl); };
  const UBl = (lx, ly) => { const dx = lx - hipC[0], dy = ly - hipC[1]; return [hipC[0] + dx * cl - dy * sl, hipC[1] + dx * sl + dy * cl]; };

  const limbW = (A, B, wA, wB, bulge = 0) => R.taper(A, B, wA * s, wB * s, bulge * s);
  const foot = (L) => {
    const a = W(...L.ank), f = new Path2D(), ang = L.toeA;
    const pts = [[-12, -14], [10, -16], [40, -10], [50, 0], [-14, 2]].map(([fx, fy]) => {
      const rx = fx * Math.cos(ang) - fy * Math.sin(ang), ry = fx * Math.sin(ang) + fy * Math.cos(ang);
      return W(L.ank[0] + rx, L.ank[1] + ry);
    });
    return Object.assign(R.smooth(pts), { pts });
  };
  G.farThigh = limbW(W(...LF.hip), W(...LF.knee), 52, 44); G.farShin = limbW(W(...LF.knee), W(...LF.ank), 44, 34); G.farFoot = foot(LF);
  G.nearThigh = limbW(W(...LN.hip), W(...LN.knee), 54, 46); G.nearShin = limbW(W(...LN.knee), W(...LN.ank), 46, 36); G.nearFoot = foot(LN);
  Object.assign(G.J, { hipN: W(...LN.hip), kneeN: W(...LN.knee), ankN: W(...LN.ank), hipF: W(...LF.hip), kneeF: W(...LF.knee), ankF: W(...LF.ank) });

  // ---- 躯干（T 恤）----
  const top = HIP_Y - 172 + drop, bot = HIP_Y + 8 + drop;
  G.torso = Object.assign(R.smooth([[-58, top + 12], [-30, top], [36, top], [64, top + 14], [70, top + 70], [58, bot - 30], [56, bot], [-52, bot], [-58, bot - 40], [-66, top + 60]].map(p => UB(...p))), {});
  G.collar = R.smooth([[-16, top + 2], [2, top + 14], [22, top + 2]].map(p => UB(...p)), false);
  G.hem = R.smooth([[-52, bot - 4], [4, bot + 2], [56, bot - 4]].map(p => UB(...p)), false);
  G.pelvis = R.smooth([[-50, bot - 16], [54, bot - 16], [58, bot + 34], [-50, bot + 34]].map(p => W(p[0], p[1])));

  // ---- 手臂 ----
  const UA = 92, FA = 86;
  const arm = (k, sho, over) => {
    const psi = phase + (1 - k) * Math.PI;                     // 与同侧腿反相
    let E, H;
    const S = UBl(...sho);
    if (over && over.t) { const r = R.ik2(S, over.t, UA, FA, over.bend ?? 1); E = r.E; H = r.H; }
    else {
      const a = -amp * 0.42 * Math.sin(psi) + 0.05;
      const eb = 0.22 + amp * 0.32 * Math.max(0, Math.sin(psi));
      E = [S[0] + Math.sin(a) * UA, S[1] + Math.cos(a) * UA];
      H = [E[0] + Math.sin(a + eb) * FA, E[1] + Math.cos(a + eb) * FA];
    }
    return { S, E, H };
  };
  const AN = arm(0, [-14, top + 22], opt.armN), AF = arm(1, [34, top + 20], opt.armF);
  const armPaths = (A) => ({ up: limbW(W(...A.S), W(...A.E), 40, 32), fo: limbW(W(...A.E), W(...A.H), 31, 25),
    sleeve: limbW(W(...A.S), W(lerp(A.S[0], A.E[0], 0.5), lerp(A.S[1], A.E[1], 0.5)), 48, 44, 0),
    hand: (() => { const h = W(...A.H), p = new Path2D(), a = Math.atan2(A.H[1] - A.E[1], (A.H[0] - A.E[0]) * dir); p.ellipse(h[0], h[1], 17 * s, 14 * s, a, 0, Math.PI * 2); return p; })() });
  const PN = armPaths(AN), PF = armPaths(AF);
  G.farUpper = PF.up; G.farFore = PF.fo; G.farSleeve = PF.sleeve; G.farHand = PF.hand;
  G.nearUpper = PN.up; G.nearFore = PN.fo; G.nearSleeve = PN.sleeve; G.nearHand = PN.hand;
  Object.assign(G.J, { shoN: W(...AN.S), elbN: W(...AN.E), handN: W(...AN.H), shoF: W(...AF.S), elbF: W(...AF.E), handF: W(...AF.H) });

  // ---- 颈与头 ----
  const neckB = UBl(4, top + 6), neckT = UBl(6, top - 20);
  G.neck = limbW(W(...neckB), W(...neckT), 34, 32);
  const hcL = [neckT[0] + 4 + 8 * (1 - turn), neckT[1] - 64];
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const HP = (lx, ly) => { const dx = lx, dy = ly; return W(hcL[0] + dx * ct - dy * st, hcL[1] + dx * st + dy * ct); };   // 头部局部（以头心为原点）
  const q = 1 - turn;                                           // 3/4 程度
  // 脸：略方的下颌，3/4 时朝前一侧的下颌更明显
  const facePts = []; for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let fx = 52 * ca, fy = 64 * sa;
    if (sa > 0) { fx *= 1 - 0.18 * sa * sa; fy *= 1 + 0.02; }
    fx += q * 6 * (ca > 0 ? 1 : 0.4) * Math.max(0, sa);
    facePts.push(HP(fx, fy));
  }
  G.face = Object.assign(R.smooth(facePts), { pts: facePts });
  // 发型
  const part = 6 * q;                                           // 中分线位置（3/4 时偏向前进方向）
  G.hairBack = R.smooth([[-68, -6], [-72, -40], [-58, -72], [-24, -92], [16, -94], [52, -76], [70, -44], [68, -4], [66, 44], [52, 50], [36, 30], [-40, 30], [-58, 50], [-72, 44]].map(p => HP(p[0] - 6 * q, p[1])));
  const bL = [[part, -88], [part - 26, -84], [-50, -66], [-64, -34], [-66, 6], [-62, 46], [-52, 52], [-52, 22], [-50, -10], [-40, -38], [part - 16, -58], [part - 3, -74]];
  const bRk = 1 - 0.32 * q;
  const bR = [[part, -88], [part + 26 * bRk, -84], [part + 54 * bRk, -66], [part + 66 * bRk, -34], [part + 64 * bRk, 6], [part + 60 * bRk, 46], [part + 50 * bRk, 50], [part + 50 * bRk, 20], [part + 48 * bRk, -10], [part + 38 * bRk, -38], [part + 16, -58], [part + 3, -74]];
  G.bangL = R.smooth(bL.map(p => HP(...p))); G.bangR = R.smooth(bR.map(p => HP(...p)));
  G.hairLines = [[[part - 4, -80], [-30, -64], [-50, -30], [-54, 20]], [[part + 4, -80], [part + 30 * bRk, -62], [part + 50 * bRk, -28], [part + 54 * bRk, 20]]]
    .map(l => R.smooth(l.map(p => HP(...p)), false));
  // 眼镜：两片圆角方框（粗黑框），3/4 时远侧镜片变窄
  const gy = -14, nearC = [-23 + 4 * q, gy], farC = [31 * (1 - 0.05 * q) + 4 * q, gy];
  const wN = 46, wF = 46 * (1 - 0.3 * q), hG = 36;
  G.glassRim = (() => { const p = new Path2D(); const add = (c, w) => { const ctr = HP(...c); rrect(p, ctr[0], ctr[1], w * s, hG * s, 9 * s); }; add(nearC, wN); add(farC, wF); return p; })();
  G.lensN = { c: HP(...nearC), w: wN * s, h: hG * s }; G.lensF = { c: HP(...farC), w: wF * s, h: hG * s };
  G.bridge = R.smooth([HP(nearC[0] + wN / 2, gy - 6), HP((nearC[0] + farC[0]) / 2 + 2, gy - 9), HP(farC[0] - wF / 2, gy - 6)], false);
  G.temple = q > 0.15 ? R.smooth([HP(nearC[0] - wN / 2, gy - 8), HP(-58, gy - 10)], false) : null;
  // 眼（镜片后，看向前进方向）、鼻、嘴
  const look = 3 * q;
  G.eyes = [{ x: HP(nearC[0] + look, gy + 2)[0], y: HP(nearC[0] + look, gy + 2)[1], r: 5.5 * s }, { x: HP(farC[0] + look * 0.8, gy + 2)[0], y: HP(farC[0] + look * 0.8, gy + 2)[1], r: 5 * s }];
  G.nose = R.smooth([HP(6 + 12 * q, 2), HP(10 + 15 * q, 16), HP(3 + 12 * q, 20)], false);
  const mx = 6 + 8 * q, sm = opt.smile ?? 1;
  G.mouth = R.smooth([HP(mx - 17, 34), HP(mx, 38 + 3 * sm), HP(mx + 17, 33), HP(mx + 10, 42 + 4 * sm), HP(mx - 1, 45 + 4 * sm), HP(mx - 11, 42 + 4 * sm)]);
  G.teeth = R.smooth([HP(mx - 15, 35), HP(mx, 38.5 + 3 * sm), HP(mx + 15, 34), HP(mx + 11, 40 + 3 * sm), HP(mx, 42 + 3.4 * sm), HP(mx - 11, 40.5 + 3 * sm)]);
  G.brows = [R.smooth([HP(nearC[0] - 16, gy - 27), HP(nearC[0], gy - 31), HP(nearC[0] + 14, gy - 28)], false), R.smooth([HP(farC[0] - 12 * (1 - 0.3 * q), gy - 28), HP(farC[0], gy - 31), HP(farC[0] + 14 * (1 - 0.3 * q), gy - 27)], false)];
  G.blink = !!opt.blink;
  G.A = { headC: HP(0, 0), headTop: HP(part, -92), chin: HP(6 * q, 62), neck: W(...neckB), chest: UB(10, top + 50), waist: UB(2, bot - 10) };
  G.HP = HP; G.W = W; G.box = [W(-120, -620), W(160, 10)];
  return G;
};

R.CARL_PAL = { skin: '#f1d3b9', hair: '#141416', hairLine: '#3a3a44', tee: '#f1eee4', teeShade: '#d9d4c6', pants: '#2c3340', shoe: '#2a2624', line: '#1b1d2a',
  rim: '#121212', lip: '#c4605a', teeth: '#fbfaf5', iris: '#2a1c14', cheek: 'rgba(235,140,120,.28)' };

// 部件画序（远→近）
R.CARL_ORDER = ['farUpper', 'farFore', 'farHand', 'farSleeve', 'farThigh', 'farShin', 'farFoot', 'nearThigh', 'nearShin', 'nearFoot', 'pelvis', 'torso', 'hairBack', 'neck', 'face',
  'cheek', 'bangL', 'bangR', 'hairLines', 'features', 'glasses', 'nearUpper', 'nearFore', 'nearHand', 'nearSleeve'];

// 默认画法：平涂＋描线。pal 可覆盖颜色；pal.paint(c,path,col,name) 接管填描；pal.features(c,G,pal) 接管五官
R.drawCarl = (c, G, pal = {}) => {
  const P0 = { ...R.CARL_PAL, ...pal }, L = P0.line, lw = pal.lw ?? 3, mode = pal.mode || 'both';
  const F = (name, p, col, line = true) => { if (!p || !col) return; if (pal.paint) { pal.paint(c, p, col, name); return; }
    if (mode !== 'line') { c.fillStyle = col; c.fill(p); } if (lw && line && mode !== 'fill') { c.strokeStyle = L; c.lineWidth = lw; c.stroke(p); } };
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  for (const n of R.CARL_ORDER) {
    if (pal.skip && pal.skip.includes(n)) continue;
    if (pal.before && pal.before[n]) pal.before[n](c, G, P0);
    switch (n) {
      case 'farUpper': case 'nearUpper': case 'farFore': case 'nearFore': case 'farHand': case 'nearHand': case 'neck': case 'face': F(n, G[n], P0.skin); break;
      case 'farSleeve': case 'nearSleeve': F(n, G[n], n === 'farSleeve' ? P0.teeShade : P0.tee); break;
      case 'farThigh': case 'farShin': case 'nearThigh': case 'nearShin': case 'pelvis': F(n, G[n], P0.pants); break;
      case 'farFoot': case 'nearFoot': F(n, G[n], P0.shoe); break;
      case 'torso': F(n, G.torso, P0.tee); if (mode !== 'fill' && lw) { c.strokeStyle = L; c.lineWidth = lw * 0.8; c.stroke(G.collar); } break;
      case 'hairBack': case 'bangL': case 'bangR': F(n, G[n], P0.hair); break;
      case 'hairLines': if (P0.hairLine && mode !== 'fill') { c.strokeStyle = P0.hairLine; c.lineWidth = 2.2 * G.s; G.hairLines.forEach(h => c.stroke(h)); } break;
      case 'cheek': if (P0.cheek) { c.save(); c.clip(G.face); c.fillStyle = P0.cheek; G.eyes.forEach(e => { c.beginPath(); c.arc(e.x, e.y + 30 * G.s, 14 * G.s, 0, Math.PI * 2); c.fill(); }); c.restore(); } break;
      case 'features': if (pal.features) pal.features(c, G, P0); else R.drawCarlFeatures(c, G, P0); break;
      case 'glasses': if (pal.glasses) pal.glasses(c, G, P0); else R.drawCarlGlasses(c, G, P0); break;
    }
    if (pal.after && pal.after[n]) pal.after[n](c, G, P0);
  }
  c.restore();
};
R.drawCarlFeatures = (c, G, P0, k = 1) => {
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  const L = P0.featureLine || P0.line;
  G.eyes.forEach(e => { if (G.blink) { c.strokeStyle = L; c.lineWidth = 2.6 * k * G.s; c.beginPath(); c.arc(e.x, e.y - 1, e.r * 1.2, 0.3, Math.PI - 0.3); c.stroke(); }
    else { c.fillStyle = P0.iris; c.beginPath(); c.ellipse(e.x, e.y, e.r * 0.85, e.r * 1.05, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(e.x - e.r * 0.3, e.y - e.r * 0.4, e.r * 0.3, 0, Math.PI * 2); c.fill(); } });
  c.strokeStyle = P0.browC || '#2a2224'; c.lineWidth = 3.4 * k * G.s; G.brows.forEach(b => c.stroke(b));
  c.strokeStyle = L; c.lineWidth = 2.4 * k * G.s; c.stroke(G.nose);
  c.fillStyle = P0.lip; c.fill(G.mouth); c.fillStyle = P0.teeth; c.fill(G.teeth); c.lineWidth = 2 * k * G.s; c.strokeStyle = L; c.stroke(G.mouth);
  c.restore();
};
R.drawCarlGlasses = (c, G, P0, k = 1) => {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = P0.rim; c.lineWidth = 7.5 * k * G.s; c.stroke(G.glassRim); c.stroke(G.bridge); if (G.temple) c.stroke(G.temple);
  if (P0.lensGlint !== false) { c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2.2 * G.s; [G.lensN, G.lensF].forEach(l => { c.beginPath(); c.moveTo(l.c[0] - l.w * 0.3, l.c[1] - l.h * 0.12); c.lineTo(l.c[0] - l.w * 0.12, l.c[1] - l.h * 0.3); c.stroke(); }); }
  c.restore();
};
})();
