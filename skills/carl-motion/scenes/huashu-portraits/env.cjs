// 在 Node 里搭出上游引擎需要的浏览器全局（与少女与猫 A 的 render.cjs 同一做法）
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas, Path2D, DOMMatrix, DOMPoint, ImageData } = require('@napi-rs/canvas');
global.window = global; global.Path2D = Path2D; global.DOMMatrix = DOMMatrix; global.ImageData = ImageData;
global.DOMPoint = DOMPoint || class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } };
global.document = { createElement: (tag) => { if (tag !== 'canvas') throw Error(tag); return createCanvas(1920, 1080); } };
global.SCENES = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f });
['upstream/lib/util.js', 'upstream/lib/paint.js', 'upstream/lib/rig.js', 'carl_rig.js'].forEach(load);
module.exports = { createCanvas, load };
