// 角色定稿预览：3/4、半转、正面，以及走路循环 6 张
const { createCanvas } = require('./env.cjs');
const fs = require('fs');
const c = createCanvas(1920, 1080), g = c.getContext('2d');
g.fillStyle = '#e9e4da'; g.fillRect(0, 0, 1920, 1080);
[[0, 0], [0.5, 0], [1, 0]].forEach(([turn], i) => RIG.drawCarl(g, RIG.carl({ x: 230 + i * 300, y: 1040, s: 0.85, turn, smile: 1 }), { lw: 3 }));
for (let k = 0; k < 6; k++) RIG.drawCarl(g, RIG.carl({ x: 1060 + k * 150, y: 1040, s: 0.62, amp: 1, phase: k / 6 * Math.PI * 2 }), { lw: 2.4 });
// 头部特写
const g2 = createCanvas(1920, 1080);
fs.writeFileSync(process.argv[2] || 'rig_preview.png', c.toBuffer('image/png'));
const h = createCanvas(900, 600), hg = h.getContext('2d'); hg.fillStyle = '#e9e4da'; hg.fillRect(0, 0, 900, 600);
[[0], [1]].forEach(([turn], i) => RIG.drawCarl(hg, RIG.carl({ x: 220 + i * 440, y: 1650, s: 2.4, turn }), { lw: 4 }));
fs.writeFileSync((process.argv[2] || 'rig_preview.png').replace('.png', '_head.png'), h.toBuffer('image/png'));
