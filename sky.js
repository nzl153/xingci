/* 星词 · 星球渲染
 *
 * 纬度 = 点亮的先后：每 50 个词一条纬度带，最早的在北、最新的在南，
 * 最新那条带发金光呼吸。亮度 = 熟练度，同时是色温（冷蓝生疏 → 暖金记牢）。
 * 第二种视图「词树」：根 → 26 个字母 → 同族词抱团，一圈圈往外长。两种视图之间星星飞过去形变。
 * 只管画和点选，词和进度都在 app.js。
 */
'use strict';

const Sky = (() => {
  const cv = document.getElementById('sky');
  const cx = cv.getContext('2d');

  let stars = [];
  let byName = new Map();
  let links = [];                  // 两头都点亮了的同族连线，球上只画这些
  let allLinks = [];               // 连暗星在内的全部同族连线，词树用来抱团
  let neigh = new Map();
  let BELTS = [];
  const EMPTY = new Set();

  const sphere = { pitch: -0.28, yaw: 0, tpitch: -0.28, tyaw: 0, spin: 0.055 };
  let zoom = 1, tzoom = 1;
  // 词树：view 是目标视图，M 是形变进度（0 = 球，1 = 树）
  let view = 'sphere', M = 0, SA = 1;
  let zoomT = 1, tzoomT = 1;
  const pan = { x: 0, y: 0 }, tpan = { x: 0, y: 0 };
  let HUBS = [], TREE_RX = 1, TREE_RY = 1, treeDirty = true;
  let LETTERS = {}, LIT_N = 0;
  const LABEL_W = new Map();          // 词名宽度缓存，每帧 measureText 上千次太贵
  let hover = null, current = null, paused = false;
  let mouse = null, hoverCandidate = null;
  let onPick = () => {}, onHover = () => {};
  const t0 = performance.now();

  const BAND = 50;
  let DENS = 1;                    // 星越多单颗越小，不然上万颗时满球糊成一片白
  const BELT_TINT = [
    [104, 150, 200], [176, 126, 100], [116, 158, 122], [156, 126, 180],
    [190, 158, 96], [110, 150, 176],
  ];

  /* 由字符串派生的稳定伪随机，保证每次打开星星位置一样 */
  function rnd(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000 - 0.5;
  }

  /* 纬度跨度随条带数长大：一两条带时贴着赤道，词多了才铺满南北，
     不然第一天只有一圈星挂在北极，很怪。 */
  function latOf(di, D) {
    const span = Math.min(1.6, 0.26 * (D - 1));
    const f = D > 1 ? di / (D - 1) : 0.5;
    return (span / 2 - f * span) * (Math.PI / 2);
  }

  /* list: [{w, b, ghost}]，已点亮的按先后排在前，词书里还没点亮的排在后面当暗星轮廓；
     edges: [[a, b]] 词对。按词书顺序点亮下一个时，它就是第一颗暗星，别的星都不用挪。 */
  function set(list, edges) {
    const old = byName;
    const D = Math.max(1, Math.ceil(list.length / BAND));
    // 抖动必须跟条带间距挂钩。写死的话 60 条带时抖动是间距的近两倍，
    // 所有批次糊成一团，「纬度=时间」直接失效。
    const gap = D > 1 ? (Math.min(1.6, 0.26 * (D - 1)) * Math.PI / 2) / (D - 1) : 0.35;
    const JIT = gap * 0.34;
    DENS = Math.min(1, Math.max(0.45, Math.sqrt(2500 / Math.max(1, list.length))));

    stars = []; byName = new Map(); BELTS = [];
    for (let di = 0; di < D; di++) {
      const lat = latOf(di, D);
      const part = list.slice(di * BAND, di * BAND + BAND);
      const n = BAND;                     // 按满员均分经度，未满的带不会挤在半圈里
      part.forEach((it, k) => {
        const lon = (k / n) * Math.PI * 2 + di * 0.9 + rnd(it.w + 'lo') * 0.12;
        const la = lat + rnd(it.w + 'la') * JIT * 2;
        const cl = Math.cos(la);
        const u = { x: cl * Math.sin(lon), y: Math.sin(la), z: cl * Math.cos(lon) };
        const prev = old.get(it.w);
        const s = {
          w: it.w, band: di, u,
          // 已有的星从旧位置滑过去：加满一条带时整颗球会重排纬度，瞬移很难看
          cu: prev ? { ...prev.cu } : { ...u },
          b: it.b,
          ph: rnd(it.w + 'p') * 6.283,
          tw: 0.6 + Math.abs(rnd(it.w + 't')) * 1.6,
          pulse: prev ? prev.pulse : 0,
          ghost: !!it.ghost,
          tx: prev ? prev.tx : 0, ty: prev ? prev.ty : 0,
          ctx: prev ? prev.ctx : null, cty: prev ? prev.cty : null,
        };
        stars.push(s);
        byName.set(it.w, s);
      });
      BELTS.push({ lat, i: di, last: false, D });
    }
    // 发金光的是最新点亮的那颗所在的带，不是最南边那条
    let lastLit = -1;
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].ghost) { lastLit = i; break; }
    if (lastLit >= 0) BELTS[Math.floor(lastLit / BAND)].last = true;
    frontier = lastLit >= 0 ? BELTS[Math.floor(lastLit / BAND)].lat : null;
    if (!current) home();
    if (current) current = byName.get(current.w) || null;

    allLinks = edges.map(([a, b]) => [byName.get(a), byName.get(b)]).filter(([a, b]) => a && b);
    links = allLinks.filter(([a, b]) => !a.ghost && !b.ghost);
    treeDirty = true;
    if (view === 'tree') layoutTree();
    // 刻度环：每个字母学了多少
    LETTERS = {};
    for (const st of stars) {
      const c = letterOf(st.w);
      if (!LETTERS[c]) LETTERS[c] = { n: 0, lit: 0 };
      LETTERS[c].n++;
      if (!st.ghost) LETTERS[c].lit++;
    }
    LIT_N = stars.filter(st => !st.ghost).length;
    neigh = new Map();
    links.forEach(([a, b]) => {
      if (!neigh.has(a)) neigh.set(a, new Set());
      if (!neigh.has(b)) neigh.set(b, new Set());
      neigh.get(a).add(b); neigh.get(b).add(a);
    });
  }

  /* 空闲时把最新点亮的那条带转到正对镜头：前沿就是你现在学到的地方 */
  let frontier = null;
  function home() {
    sphere.tpitch = frontier === null ? -0.28 : Math.max(-1.1, Math.min(1.1, frontier));
  }

  function setBright(w, b, pulse) {
    const s = byName.get(w);
    if (!s) return;
    s.b = b;
    if (pulse) s.pulse = pulse;
  }

  function faceU(u) {
    const yaw = Math.atan2(-u.x, u.z);
    const pitch = Math.atan2(u.y, Math.hypot(u.x, u.z));
    // 取最近的等价角，不然会绕远路转一大圈
    let d = yaw - sphere.tyaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sphere.tyaw += d;
    sphere.tpitch = pitch;
  }

  function focus(w, z) {
    current = w ? byName.get(w) || null : null;
    if (current) { faceU(current.u); current.pulse = 1; } else home();
    if (z) tzoom = z;
    if (view === 'tree' && current) {
      tpan.x = -current.tx; tpan.y = -current.ty;
      tzoomT = Math.max(tzoomT, 4.5);
    }
  }

  /* 新词还不是星：先把镜头对准最新那条带，点亮后它就出现在那里 */
  function focusNewest(z) {
    current = null;
    const D = BELTS.length;
    const lat = latOf(Math.max(0, D - 1), D);
    const cl = Math.cos(lat);
    const lon = -sphere.tyaw;
    faceU({ x: cl * Math.sin(lon), y: Math.sin(lat), z: cl * Math.cos(lon) });
    if (z) tzoom = z;
  }

  /* ---------------- 预渲染精灵 ---------------- */

  const SPR = [];
  const DOT = [];                  // 暗星不画整张辉光精灵，只画一个点：几千颗星时这是大头
  const SPRN = 12;
  const SPRR = 44;

  function colorAt(b) {
    const cold = [150, 178, 210], warm = [255, 246, 232], gold = [255, 214, 140];
    const t = Math.max(0, Math.min(1, b));
    const [a, c, k] = t < 0.55 ? [cold, warm, t / 0.55] : [warm, gold, (t - 0.55) / 0.45];
    return a.map((v, i) => Math.round(v + (c[i] - v) * k));
  }

  function bakeSprites() {
    if (SPR.length) return;
    for (let i = 0; i < SPRN; i++) {
      const b = (i + 0.5) / SPRN;
      const [r, g, bl] = colorAt(b);
      const cn = document.createElement('canvas');
      cn.width = cn.height = SPRR * 2;
      const c2 = cn.getContext('2d');
      const gl = c2.createRadialGradient(SPRR, SPRR, 0, SPRR, SPRR, SPRR);
      gl.addColorStop(0.00, `rgba(${r},${g},${bl},${0.55 * b})`);
      gl.addColorStop(0.18, `rgba(${r},${g},${bl},${0.20 * b})`);
      gl.addColorStop(0.45, `rgba(${r},${g},${bl},${0.05 * b})`);
      gl.addColorStop(1.00, `rgba(${r},${g},${bl},0)`);
      c2.fillStyle = gl;
      c2.fillRect(0, 0, SPRR * 2, SPRR * 2);
      // 衍射星芒：亮星才有，暗星不画，否则满屏毛刺
      if (b > 0.45) {
        const len = SPRR * (0.30 + b * 0.62);
        const a = (b - 0.45) / 0.55;
        c2.save();
        c2.translate(SPRR, SPRR);
        for (const rot of [0, Math.PI / 2]) {
          c2.rotate(rot);
          const sp = c2.createLinearGradient(-len, 0, len, 0);
          sp.addColorStop(0.00, `rgba(${r},${g},${bl},0)`);
          sp.addColorStop(0.50, `rgba(${r},${g},${bl},${0.5 * a})`);
          sp.addColorStop(1.00, `rgba(${r},${g},${bl},0)`);
          c2.fillStyle = sp;
          c2.fillRect(-len, -0.7, len * 2, 1.4);
          c2.rotate(-rot);
        }
        c2.restore();
      }
      const core = 1.1 + b * 2.6;
      const cg = c2.createRadialGradient(SPRR, SPRR, 0, SPRR, SPRR, core);
      cg.addColorStop(0, `rgba(255,255,255,${0.75 + 0.25 * b})`);
      cg.addColorStop(1, `rgba(${r},${g},${bl},${0.85 * b})`);
      c2.fillStyle = cg;
      c2.beginPath(); c2.arc(SPRR, SPRR, core, 0, 6.283); c2.fill();
      SPR.push(cn);
      DOT.push(`rgb(${r},${g},${bl})`);
    }
  }

  let DUST = [];
  function makeDust() {
    if (DUST.length) return;
    for (let layer = 0; layer < 3; layer++) {
      const pts = [];
      const n = [240, 150, 80][layer];
      for (let i = 0; i < n; i++) {
        pts.push({
          x: rnd('d' + layer + i) * 4200,
          y: rnd('e' + layer + i) * 4200,
          a: 0.05 + Math.abs(rnd('f' + layer + i)) * (0.10 + layer * 0.08),
          s: 0.6 + layer * 0.35,
        });
        pts[pts.length - 1].c = `rgba(226,232,240,${pts[pts.length - 1].a.toFixed(3)})`;
      }
      DUST.push({ pts, k: 0.18 + layer * 0.16 });
    }
  }

  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bakeNebula();
  }

  /* ---------------- 投影 ---------------- */

  const CAMD = 3.15;
  const PROJ = { r: 260, cx: 0, cy: 0 };
  let rot = { cy: 1, sy: 0, cp: 1, sp: 0 };

  function project(u) {
    let x = u.x * rot.cy + u.z * rot.sy;
    let z = -u.x * rot.sy + u.z * rot.cy;
    const y = u.y * rot.cp - z * rot.sp;
    z = u.y * rot.sp + z * rot.cp;
    const k = CAMD / (CAMD - z);
    return { x: PROJ.cx + x * PROJ.r * k, y: PROJ.cy - y * PROJ.r * k, z, k };
  }

  function famSet() {
    const seed = hover || current;
    if (!seed || !neigh.has(seed)) return EMPTY;
    const out = new Set([seed]);
    neigh.get(seed).forEach(x => out.add(x));
    return out;
  }

  /* ---------------- 词树 ----------------
   * 根在中间，26 个字母一圈围着它。每个字母底下的词一圈圈往外排：
   * 已点亮的在里圈、暗星在外圈，同族词排在相邻的位置抱成一团。
   * 每个词连向里一圈离它最近的词，最里圈连向字母，于是整个字母长成一棵放射状的小树。
   * 单位是「相邻两颗星的间距」，画的时候再整体缩放到屏幕里。 */
  function letterOf(w) { const c = w[0]; return c >= 'a' && c <= 'z' ? c : '#'; }

  function layoutTree() {
    treeDirty = false;
    // 同一个字母里的同族词先并成一组
    const root = new Map();
    const find = x => { while (root.get(x) !== x) { root.set(x, root.get(root.get(x))); x = root.get(x); } return x; };
    stars.forEach(st => root.set(st, st));
    for (const [a, b] of allLinks) if (letterOf(a.w) === letterOf(b.w)) root.set(find(a), find(b));

    const byL = new Map();
    for (const st of stars) {
      const ch = letterOf(st.w);
      if (!byL.has(ch)) byL.set(ch, new Map());
      const g = byL.get(ch), r = find(st);
      if (!g.has(r)) g.set(r, []);
      g.get(r).push(st);
    }

    const blobs = [];
    for (const ch of [...byL.keys()].sort()) {
      const groups = [...byL.get(ch).values()].map(m => {
        m.sort((a, b) => (a.ghost - b.ghost) || (a.w < b.w ? -1 : 1));
        return { m, lit: m.filter(x => !x.ghost).length };
      });
      // 有点亮的组在前（大族在前），全是暗星的组在后，各自按字母序
      groups.sort((a, b) => (!a.lit - !b.lit) || (b.m.length > 1) - (a.m.length > 1) ||
                            (a.m[0].w < b.m[0].w ? -1 : 1));
      const order = groups.flatMap(g => g.m);
      const rings = [];
      for (let k = 1, i = 0; i < order.length; k++) {
        const n = Math.min(Math.floor(Math.PI * 2 * k), order.length - i);
        rings.push(order.slice(i, i + n));
        i += n;
      }
      blobs.push({ ch, rings, r: rings.length + 1.2, n: order.length, lit: order.filter(x => !x.ghost).length });
    }

    // 字母按占地大小分角度，围成一圈
    const need = blobs.reduce((a, b) => a + b.r * 2 + 1.6, 0);
    const Rc = Math.max(need / (Math.PI * 2), Math.max(...blobs.map(b => b.r), 1) * 1.6 + 4);
    // 宽屏上排成横向的椭圆，不然左右两大片空着
    const AX = Math.max(1, Math.min(1.7, W / Math.max(1, H)));
    let acc = 0, HUBS_N = 0;
    HUBS = blobs.map(b => {
      const th = -Math.PI / 2 + ((acc + b.r + 0.8) / need) * Math.PI * 2;
      acc += b.r * 2 + 1.6;
      const hub = { ch: b.ch, i: HUBS_N++, x: Math.cos(th) * Rc * AX, y: Math.sin(th) * Rc, th, n: b.n, lit: b.lit, r: b.r };
      b.rings.forEach((ring, ki) => {
        const k = ki + 1;
        ring.forEach((st, j) => {
          // 每圈从朝向根的那一侧开始排，里圈的词离主干近
          const a = th + Math.PI + (j / ring.length) * Math.PI * 2 + (k % 2) * 0.35;
          st.tx = hub.x + Math.cos(a) * k;
          st.ty = hub.y + Math.sin(a) * k;
          st.hub = hub;
          st.tparent = ki === 0 ? null
            : b.rings[ki - 1][Math.round((j / ring.length) * b.rings[ki - 1].length) % b.rings[ki - 1].length];
          if (st.ctx === null) { st.ctx = st.tx; st.cty = st.ty; }
        });
      });
      return hub;
    });
    const rmax = Math.max(...blobs.map(b => b.r), 1);
    TREE_RX = Rc * AX + rmax;
    TREE_RY = Rc + rmax;
  }

  const TS = () => Math.min(W * 0.47 / TREE_RX, H * 0.43 / TREE_RY);
  const treeXY = (x, y) => {
    const k = TS() * zoomT;
    return { x: W / 2 + (x + pan.x) * k, y: H / 2 + (y + pan.y) * k };
  };

  /* 词树的骨架：根 → 字母的主干、字母 → 词的枝、同族连线、字母节点。
     a 是整体透明度（形变快结束时才长出来）。鼠标停着的那颗星，它到根的整条路径发金光 */
  function drawTree(a, famLit, t) {
    const O = treeXY(0, 0);
    const k = TS() * zoomT;
    // 主干
    cx.lineWidth = 1.4;
    cx.beginPath();
    for (const h of HUBS) {
      const p = treeXY(h.x, h.y);
      const mx = (O.x + p.x) / 2 - (p.y - O.y) * 0.12, my = (O.y + p.y) / 2 + (p.x - O.x) * 0.12;
      cx.moveTo(O.x, O.y); cx.quadraticCurveTo(mx, my, p.x, p.y);
    }
    cx.strokeStyle = `rgba(217,164,65,${0.22 * a})`;
    cx.stroke();
    // 枝：词连向里一圈，最里圈连向字母
    cx.lineWidth = 1;
    for (const lit of [false, true]) {
      cx.beginPath();
      for (const st of stars) {
        if (!st.hub || st.ghost === lit) continue;
        const p = st._p, q = st.tparent ? st.tparent._p : treeXY(st.hub.x, st.hub.y);
        cx.moveTo(p.x, p.y); cx.lineTo(q.x, q.y);
      }
      cx.strokeStyle = lit ? `rgba(140,176,214,${0.16 * a})` : `rgba(120,136,160,${0.07 * a})`;
      cx.stroke();
    }
    // 同族：字母内部的短，跨字母的是一条淡淡的长弧
    for (const cross of [false, true]) {
      cx.beginPath();
      for (const [x, y] of allLinks) {
        if ((x.hub !== y.hub) !== cross) continue;
        const p = x._p, q = y._p;
        const bend = cross ? 0.18 : 0.3;
        cx.moveTo(p.x, p.y);
        cx.quadraticCurveTo((p.x + q.x) / 2 - (q.y - p.y) * bend, (p.y + q.y) / 2 + (q.x - p.x) * bend, q.x, q.y);
      }
      cx.lineWidth = cross ? 0.8 : 1.2;
      cx.strokeStyle = cross ? `rgba(230,190,120,${0.07 * a})` : `rgba(236,196,128,${0.38 * a})`;
      cx.stroke();
    }
    // 鼠标停着的那颗：到根的路径
    const seed = hover || current;
    if (seed && seed.hub) {
      cx.beginPath();
      let x = seed;
      cx.moveTo(x._p.x, x._p.y);
      while (x.tparent) { x = x.tparent; cx.lineTo(x._p.x, x._p.y); }
      const hp = treeXY(seed.hub.x, seed.hub.y);
      cx.lineTo(hp.x, hp.y); cx.lineTo(O.x, O.y);
      cx.lineWidth = 2; cx.strokeStyle = `rgba(255,214,140,${0.7 * a})`;
      cx.stroke();
    }
    // 字母节点和根
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    for (const h of HUBS) {
      const p = treeXY(h.x, h.y);
      const f = h.lit / Math.max(1, h.n);
      const rr = Math.max(9, Math.min(22, k * 0.9));
      cx.fillStyle = `rgba(20,17,15,${0.85 * a})`;
      cx.beginPath(); cx.arc(p.x, p.y, rr, 0, 6.283); cx.fill();
      cx.lineWidth = 2;
      cx.strokeStyle = `rgba(120,150,190,${0.35 * a})`;
      cx.beginPath(); cx.arc(p.x, p.y, rr, 0, 6.283); cx.stroke();
      // 外圈金色弧 = 这个字母点亮了多少
      cx.strokeStyle = `rgba(240,196,120,${0.9 * a})`;
      cx.beginPath(); cx.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + f * 6.283); cx.stroke();
      cx.font = `600 ${Math.round(rr * 1.05)}px Georgia, serif`;
      cx.fillStyle = `rgba(242,236,227,${a})`;
      cx.fillText(h.ch, p.x, p.y + 1);
    }
    const glow = cx.createRadialGradient(O.x, O.y, 0, O.x, O.y, 60);
    glow.addColorStop(0, `rgba(240,196,120,${0.35 * a})`);
    glow.addColorStop(1, 'rgba(240,196,120,0)');
    cx.fillStyle = glow;
    cx.beginPath(); cx.arc(O.x, O.y, 60, 0, 6.283); cx.fill();
    cx.font = '600 20px Georgia, "Microsoft YaHei", serif';
    cx.fillStyle = `rgba(250,236,210,${a * (0.85 + Math.sin(t * 1.5) * 0.15)})`;
    cx.fillText('星词', O.x, O.y);
    cx.textBaseline = 'alphabetic';
  }

  /* 切换视图。球 → 树时星星按字母先后一波波飞出去，树 → 球时反过来 */
  function setView(v, instant) {
    view = v;
    if (v === 'tree') {
      if (treeDirty) layoutTree();
      if (!instant || !current) { tpan.x = tpan.y = 0; tzoomT = 1; }
      pan.x = tpan.x; pan.y = tpan.y; zoomT = tzoomT;
    } else home();
    if (instant) M = v === 'tree' ? 1 : 0;
  }

  /* ---------------- 星云、流星 ---------------- */

  // 星云只在尺寸变化时画一次，每帧贴图
  let NEB = null;
  function bakeNebula() {
    NEB = document.createElement('canvas');
    const w = NEB.width = Math.round(W * 1.2), h = NEB.height = Math.round(H * 1.2);
    const c2 = NEB.getContext('2d');
    const blob = (x, y, r, rgb, a) => {
      const g = c2.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(0.45, `rgba(${rgb},${a * 0.45})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      c2.fillStyle = g;
      c2.fillRect(0, 0, w, h);
    };
    const m = Math.max(w, h);
    blob(w * 0.18, h * 0.28, m * 0.42, '58,92,160', 0.11);
    blob(w * 0.84, h * 0.76, m * 0.40, '150,84,78', 0.075);
    blob(w * 0.66, h * 0.14, m * 0.26, '104,78,160', 0.06);
    blob(w * 0.34, h * 0.86, m * 0.30, '46,110,130', 0.05);
  }

  const METEORS = [];
  let nextMeteor = 4;
  function drawMeteors(t, dt) {
    if (t > nextMeteor) {
      nextMeteor = t + 6 + Math.random() * 10;
      const ang = 2.35 + (Math.random() - 0.5) * 0.4;       // 从右上往左下划
      METEORS.push({ x: W * (0.35 + Math.random() * 0.65), y: H * Math.random() * 0.35,
                     vx: Math.cos(ang) * 900, vy: Math.sin(ang) * 900, life: 0.75, age: 0 });
    }
    cx.lineWidth = 1.2;
    for (let i = METEORS.length - 1; i >= 0; i--) {
      const m = METEORS[i];
      m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.age > m.life) { METEORS.splice(i, 1); continue; }
      const a = Math.sin(Math.PI * m.age / m.life) * 0.55;
      const tx = m.x - m.vx * 0.11, ty = m.y - m.vy * 0.11;
      const g = cx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,240,220,${a})`);
      g.addColorStop(1, 'rgba(255,240,220,0)');
      cx.strokeStyle = g;
      cx.beginPath(); cx.moveTo(m.x, m.y); cx.lineTo(tx, ty); cx.stroke();
    }
  }

  /* 同族连线上有光点从这颗星流向亲戚：一眼看出是谁连着谁 */
  function flowOnLinks(L, t) {
    if (!L.length) return;
    const seed = hover || current;
    cx.globalCompositeOperation = 'lighter';
    cx.beginPath();
    for (const [a0, b0] of L) {
      const [a, b] = a0 === seed ? [a0, b0] : [b0, a0];
      const p = a._p, q = b._p;
      const mx = (p.x + q.x) / 2 - (q.y - p.y) * 0.06, my = (p.y + q.y) / 2 + (q.x - p.x) * 0.06;
      for (let i = 0; i < 2; i++) {
        const f = (t * 0.7 + i * 0.5 + (a.ph + b.ph) * 0.1) % 1, g = 1 - f;
        const x = g * g * p.x + 2 * g * f * mx + f * f * q.x, y = g * g * p.y + 2 * g * f * my + f * f * q.y;
        cx.moveTo(x + 2.2, y); cx.arc(x, y, 2.2, 0, 6.283);
      }
    }
    cx.fillStyle = 'rgba(255,220,150,.8)';
    cx.fill();
    cx.globalCompositeOperation = 'source-over';
  }

  let last = 0;
  function frame(now) {
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    const k = 1 - Math.pow(0.0001, dt);

    // 形变 1.5 秒走完
    M = Math.max(0, Math.min(1, M + (view === 'tree' ? 1 : -1) * dt / 1.5));
    SA = 1 - M;
    zoomT += (tzoomT - zoomT) * k;
    pan.x += (tpan.x - pan.x) * k;
    pan.y += (tpan.y - pan.y) * k;

    // 没有卡片时自己慢慢转；卡片开着就停，不然刚飞到的星又转走了
    if (!paused && !drag && M < 1) sphere.tyaw += sphere.spin * dt;
    sphere.yaw += (sphere.tyaw - sphere.yaw) * k;
    sphere.pitch += (sphere.tpitch - sphere.pitch) * k;
    zoom += (tzoom - zoom) * k;
    rot = { cy: Math.cos(sphere.yaw), sy: Math.sin(sphere.yaw),
            cp: Math.cos(sphere.pitch), sp: Math.sin(sphere.pitch) };

    // 手机竖屏时球别被顶栏和卡片挤没：取短边，竖屏往上挪一点
    PROJ.cx = W / 2;
    PROJ.cy = H / 2 - (H > W * 1.2 ? H * 0.08 : 0);
    PROJ.r = Math.min(W, H) * (H > W * 1.2 ? 0.40 : 0.34) * zoom;

    cx.fillStyle = '#0a090b';
    cx.fillRect(0, 0, W, H);
    if (NEB) cx.drawImage(NEB, -W * 0.1 + Math.sin(sphere.yaw * 0.5) * W * 0.06, -H * 0.1 + sphere.pitch * H * 0.04);

    DUST.forEach(({ pts, k: pk }) => {
      const off = sphere.yaw * 300 * pk;
      pts.forEach(p => {
        const sx = (((p.x - off) % W) + W) % W;
        const sy = ((p.y % H) + H) % H;
        cx.fillStyle = p.c;
        cx.fillRect(sx, sy, p.s, p.s);
      });
    });
    drawMeteors(t, dt);

    const Rp = PROJ.r;
    cx.globalAlpha = SA;
    // 只贴着球缘一圈薄光，黑的地方要真黑
    const rim = cx.createRadialGradient(PROJ.cx, PROJ.cy, Rp * 0.93, PROJ.cx, PROJ.cy, Rp * 1.09);
    rim.addColorStop(0.00, 'rgba(96,140,196,0)');
    rim.addColorStop(0.42, 'rgba(110,158,214,.20)');
    rim.addColorStop(0.72, 'rgba(96,140,196,.09)');
    rim.addColorStop(1.00, 'rgba(96,140,196,0)');
    cx.fillStyle = rim;
    cx.beginPath(); cx.arc(PROJ.cx, PROJ.cy, Rp * 1.09, 0, 6.283); cx.fill();

    const core = cx.createRadialGradient(PROJ.cx - Rp * 0.28, PROJ.cy - Rp * 0.30, 0, PROJ.cx, PROJ.cy, Rp);
    core.addColorStop(0.00, 'rgba(52,74,104,.20)');
    core.addColorStop(0.60, 'rgba(20,26,38,.10)');
    core.addColorStop(1.00, 'rgba(8,10,14,0)');
    cx.fillStyle = core;
    cx.beginPath(); cx.arc(PROJ.cx, PROJ.cy, Rp, 0, 6.283); cx.fill();

    if (SA > 0.01) {
      drawGrid();
      drawBelts(t);
      drawOrbit(t, dt);
      drawDial();
    }
    cx.globalAlpha = 1;

    const famLit = famSet();

    const mk = 1 - Math.pow(0.02, dt);
    stars.forEach(s => {
      s.cu.x += (s.u.x - s.cu.x) * mk;
      s.cu.y += (s.u.y - s.cu.y) * mk;
      s.cu.z += (s.u.z - s.cu.z) * mk;
      let p = project(s.cu);
      s._e = 0;
      if (M > 0 && s.ctx !== null) {
        s.ctx += (s.tx - s.ctx) * mk;
        s.cty += (s.ty - s.cty) * mk;
        // 按字母先后错开出发：去的时候 a 先走，回来的时候 z 先走。
        // 错开太多的话 a 早到了 z 还在飞，结尾像一截截补上来，所以只错开四分之一
        const L = s.hub ? s.hub.i / Math.max(1, HUBS.length - 1) : 0.5;
        const l = Math.max(0, Math.min(1, M * 1.25 - L * 0.25));
        const e = l < 0.5 ? 4 * l * l * l : 1 - Math.pow(-2 * l + 2, 3) / 2;
        const q = treeXY(s.ctx, s.cty);
        const dx = q.x - p.x, dy = q.y - p.y;
        const bend = Math.sin(Math.PI * e) * 0.18;          // 走一条弧线，不是直线平移
        p = { x: p.x + dx * e - dy * bend, y: p.y + dy * e + dx * bend,
              z: p.z + (0.7 - p.z) * e, k: p.k + (1 - p.k) * e };
        s._e = e;
      }
      s._p = p;
    });
    // 树上星的大小跟着树的缩放走，但别放得跟球上拉近时一样大
    const zOf = s => zoom + (Math.min(2.2, 0.75 + zoomT * 0.35) - zoom) * s._e;
    if (M > 0) cx.globalAlpha = 1;

    // 暗星：只画一个灰点，按朝向分三档各合并成一笔。
    // 球缘的点投影后挤在一起，不压淡的话会叠成一圈亮环，比真星还抢眼
    const ghostPass = () => {
      const LV = 8, bins = Array.from({ length: LV }, () => []);
      for (const s of stars) {
        if (!s.ghost || s === current) continue;
        const p = s._p;
        const f = Math.max(0, Math.min(1, (p.z + 0.1) / 0.8));
        const g = f * f * (3 - 2 * f);
        const r = (1 + 0.7 * g) * p.k * Math.min(1.4, zOf(s));
        bins[Math.min(LV - 1, Math.floor(g * LV))].push(p.x - r / 2, p.y - r / 2, r);
      }
      bins.forEach((b, i) => {
        if (!b.length) return;
        cx.beginPath();
        for (let j = 0; j < b.length; j += 3) cx.rect(b[j], b[j + 1], b[j + 2], b[j + 2]);
        cx.fillStyle = `rgba(150,166,188,${0.05 + 0.25 * (i + 0.5) / LV})`;
        cx.fill();
      });
    };

    // 普通连线按深度分 4 档各画一笔：两千条线逐条 stroke 是上万颗星时最贵的一块
    const curve = (p, q) => {
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      cx.moveTo(p.x, p.y);
      cx.quadraticCurveTo(mx - (q.y - p.y) * 0.06, my + (q.x - p.x) * 0.06, q.x, q.y);
    };
    const litL = [];
    const linkPass = lvs => {
      if (SA < 0.02) return;
      cx.globalAlpha = SA * SA;
      cx.lineWidth = 1;
      for (const lv of lvs) {
        cx.beginPath();
        for (const L of links) {
          const [a, b] = L;
          if (famLit.has(a) && famLit.has(b)) { if (lv === 0) litL.push(L); continue; }
          const dep = (Math.min(a._p.z, b._p.z) + 1) / 2;
          if (Math.min(3, Math.floor(dep * 4)) !== lv) continue;
          curve(a._p, b._p);
        }
        cx.strokeStyle = `rgba(120,158,196,${0.012 + 0.055 * (lv + 0.5) / 4})`;
        cx.stroke();
      }
      cx.globalAlpha = 1;
    };

    hoverCandidate = null;
    let best = Infinity;
    const starPass = front => {
      cx.globalCompositeOperation = 'lighter';
      for (const s of stars) {
        const p = s._p;
        if ((p.z >= 0) !== front) continue;
        if (s.ghost && s !== current) continue;
        if (s.pulse > 0) s.pulse *= Math.pow(0.06, dt);
        const dep = (p.z + 1) / 2;
        const lit0 = 0.72 + 0.28 * Math.max(0,
          -0.45 * (p.x - PROJ.cx) / Rp - 0.45 * (p.y - PROJ.cy) / Rp + p.z * 0.55);
        const lit = lit0 + (1 - lit0) * (s._e || 0);
        const tw = 0.84 + Math.sin(t * (1.1 + s.tw) + s.ph) * 0.16;
        let b = s.b * tw * (0.14 + dep * 0.92) * lit * 1.18 + s.pulse * 0.7;
        if (s === current || famLit.has(s)) b = Math.min(1, b + 0.34);
        b = Math.max(0.02, Math.min(1, b));
        const si = Math.max(0, Math.min(SPRN - 1, Math.floor(b * SPRN) || 0));
        let sc = (0.30 + b * 0.48) * p.k * zOf(s) * (1 + s.pulse * 0.9) * DENS;
        if (s._e) {
          // 树上两颗星只隔几个像素，照球上的尺寸画，辉光会叠成一团白
          const tree = Math.max(0.07, Math.min(0.9, TS() * zoomT / 34)) * (0.5 + 0.7 * b) * (1 + s.pulse * 0.9);
          sc += (tree - sc) * s._e;
        }
        if ((b < 0.13 || sc < 0.16) && p.z < 0 && !s._e) {
          const r = 0.5 + sc * 2.2;
          cx.globalAlpha = b * 4;
          cx.fillStyle = DOT[si];
          cx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
          cx.globalAlpha = 1;
          continue;                        // 背面的点不参与点选
        }
        const d = SPRR * 2 * sc;
        cx.drawImage(SPR[si], p.x - d / 2, p.y - d / 2, d, d);
        s._r = Math.max(3, 4 * sc);
        // 只有正面的星可以被指到，背面的点不着
        if (mouse && p.z > 0.02) {
          const dd = Math.hypot(mouse.x - p.x, mouse.y - p.y);
          if (dd < Math.max(mouse.touch ? 18 : 10, s._r + 7) && dd < best) { best = dd; hoverCandidate = s; }
        }
      }
      cx.globalCompositeOperation = 'source-over';
    };

    if (M > 0.5) drawTree(Math.pow((M - 0.5) / 0.5, 2), famLit, t);
    ghostPass();
    linkPass([0, 1, 2, 3]);
    for (const [a, b] of litL) {
      const dep = (Math.min(a._p.z, b._p.z) + 1) / 2;
      cx.lineWidth = 4; cx.strokeStyle = `rgba(217,164,65,${0.10 * (0.3 + dep)})`;
      cx.beginPath(); curve(a._p, b._p); cx.stroke();
      cx.lineWidth = 1.3; cx.strokeStyle = `rgba(240,200,120,${0.25 + 0.55 * dep})`;
      cx.beginPath(); curve(a._p, b._p); cx.stroke();
    }
    flowOnLinks(litL, t);
    starPass(false);
    starPass(true);

    if (current && current._p && current.pulse > 0.01 && current._p.z > -0.2) {
      const rr = 14 + (1 - current.pulse) * 90;
      cx.strokeStyle = `rgba(240,196,120,${current.pulse * 0.55})`;
      cx.lineWidth = 1.6;
      cx.beginPath(); cx.arc(current._p.x, current._p.y, rr, 0, 6.283); cx.stroke();
    }

    // 词形：放大到一定程度才显示，且只显示正面的
    const labelA = M < 0.5 ? Math.min(1, (zoom - 1.5) / 0.7) : Math.min(1, (TS() * zoomT - 13) / 6) * (M - 0.5) * 2;
    if (labelA > 0.04) {
      cx.font = '11px Georgia, serif';
      cx.textAlign = 'center';
      // 标签互相压住就没法读：按每个词实际的宽度做碰撞，放不下就不画。
      // 离镜头近的先占，一样近（词树上）就让亮的、正被指着的那一族先占
      const fam = famSet();
      const cand = stars.filter(s => !s.ghost && s._p.z >= 0.25 &&
                                     s._p.x > -60 && s._p.x < W + 60 && s._p.y > -20 && s._p.y < H + 20)
        .sort((a, b) => (fam.has(b) - fam.has(a)) || (b._p.z - a._p.z) || (b.b - a.b));
      const grid = new Map();
      const hit = (x0, y0, x1, y1) => {
        for (let gx = Math.floor(x0 / 48); gx <= Math.floor(x1 / 48); gx++) {
          for (let gy = Math.floor(y0 / 16); gy <= Math.floor(y1 / 16); gy++) {
            for (const r of grid.get(gx * 4096 + gy) || []) {
              if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return true;
            }
          }
        }
        return false;
      };
      for (const s of cand) {
        const p = s._p;
        const y = p.y - s._r - 5;
        if (!LABEL_W.has(s.w)) LABEL_W.set(s.w, cx.measureText(s.w).width);
        const hw = LABEL_W.get(s.w) / 2 + 3;
        const box = [p.x - hw, y - 11, p.x + hw, y + 3];
        if (hit(...box)) continue;
        for (let gx = Math.floor(box[0] / 48); gx <= Math.floor(box[2] / 48); gx++) {
          for (let gy = Math.floor(box[1] / 16); gy <= Math.floor(box[3] / 16); gy++) {
            const k = gx * 4096 + gy;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(box);
          }
        }
        const a = labelA * Math.min(1, (p.z - 0.25) / 0.45) * 0.85;
        if (a <= 0.04) continue;
        cx.fillStyle = `rgba(242,236,227,${a})`;
        cx.fillText(s.w, p.x, y);
      }
    }

    if (!mouse || !mouse.touch) setHover(hoverCandidate);
    requestAnimationFrame(frame);
  }

  function ring(lat, steps, minZ) {
    const cl = Math.cos(lat), sl = Math.sin(lat);
    let started = false;
    cx.beginPath();
    for (let k = 0; k <= steps; k++) {
      const lo = (k / steps) * Math.PI * 2;
      const p = project({ x: cl * Math.sin(lo), y: sl, z: cl * Math.cos(lo) });
      if (p.z < minZ) { started = false; continue; }
      if (!started) { cx.moveTo(p.x, p.y); started = true; } else cx.lineTo(p.x, p.y);
    }
  }

  /* 每批一条纬度带。只有最新那条亮，条带一多就会盖过星星。
     最新那条上还有光点沿着带子流动：你现在学到的地方 */
  function drawBelts(t) {
    const step = BELTS.length > 20 ? Math.ceil(BELTS.length / 14) : 1;
    BELTS.forEach(bt => {
      if (!bt.last && bt.i % step !== 0) return;
      const [r, g, b] = bt.last ? [235, 178, 92] : BELT_TINT[bt.i % BELT_TINT.length];
      const pulse = bt.last ? 0.5 + 0.5 * Math.sin(t * 1.5) : 0;
      const a = bt.last ? 0.34 + pulse * 0.26 : 0.045;
      for (const pass of (bt.last ? [0, 1] : [1])) {
        ring(bt.lat, 56, 0.02);
        cx.lineWidth = pass === 0 ? 8 : (bt.last ? 1.5 : 0.9);
        cx.strokeStyle = `rgba(${r},${g},${b},${pass === 0 ? a * 0.22 : a})`;
        cx.stroke();
      }
      if (bt.last && LIT_N) {
        // 找这条带在正面最靠右的点，把「第几批」写在它外侧
        const cl = Math.cos(bt.lat), sl = Math.sin(bt.lat);
        let best = null;
        for (let k = 0; k < 72; k++) {
          const lo = (k / 72) * Math.PI * 2;
          const p = project({ x: cl * Math.sin(lo), y: sl, z: cl * Math.cos(lo) });
          if (p.z > 0.1 && (!best || p.x > best.x)) best = p;
        }
        if (best) {
          const from = bt.i * BAND + 1, to = Math.min(LIT_N, bt.i * BAND + BAND);
          cx.font = 'italic 11px Georgia, "Microsoft YaHei", serif';
          cx.textAlign = 'left';
          cx.fillStyle = 'rgba(240,206,150,.62)';
          cx.fillText(`第 ${bt.i + 1} 批 · ${from}–${to}`, best.x + 12, best.y + 4);
        }
      }
      if (bt.last) {
        cx.globalCompositeOperation = 'lighter';
        ring(bt.lat, 96, 0.05);
        cx.setLineDash([2, 22]);
        cx.lineDashOffset = -t * 40;
        cx.lineCap = 'round';
        cx.lineWidth = 3;
        cx.strokeStyle = 'rgba(255,224,160,.75)';
        cx.stroke();
        cx.setLineDash([]);
        cx.lineCap = 'butt';
        cx.globalCompositeOperation = 'source-over';
      }
    });
  }

  /* 斜轨道：一条细线，上面有三颗带拖尾的小卫星在绕。转到球背后的那段压暗 */
  const SATS = [{ o: 0, v: 0.22, s: 2.2 }, { o: 2.3, v: 0.16, s: 1.6 }, { o: 4.1, v: 0.27, s: 1.3 }];
  const orbitAt = (a, tilt) => {
    const x0 = Math.cos(a) * 1.42, z0 = Math.sin(a) * 1.42;
    return project({ x: x0, y: z0 * Math.sin(tilt), z: z0 * Math.cos(tilt) });
  };
  function drawOrbit(t) {
    const tilt = 0.62, spin = t * 0.10;
    for (const pass of [0, 1]) {
      cx.beginPath();
      for (let k = 0; k <= 88; k++) {
        const p = orbitAt((k / 88) * Math.PI * 2 + spin, tilt);
        if (k === 0) cx.moveTo(p.x, p.y); else cx.lineTo(p.x, p.y);
      }
      cx.closePath();
      cx.lineWidth = pass === 0 ? 5 : 1;
      cx.strokeStyle = pass === 0 ? 'rgba(150,180,220,.035)' : 'rgba(170,200,235,.13)';
      cx.stroke();
    }
    cx.globalCompositeOperation = 'lighter';
    for (const sat of SATS) {
      const a = sat.o + t * sat.v;
      const head = orbitAt(a, tilt);
      const behind = head.z < 0 && Math.hypot(head.x - PROJ.cx, head.y - PROJ.cy) < PROJ.r;
      const dim = behind ? 0.25 : 1;
      cx.lineCap = 'round';
      let prev = head;
      for (let i = 1; i <= 14; i++) {
        const p = orbitAt(a - i * 0.03, tilt);
        cx.lineWidth = sat.s * (1 - i / 16) * 1.4;
        cx.strokeStyle = `rgba(190,215,245,${0.32 * (1 - i / 15) * dim})`;
        cx.beginPath(); cx.moveTo(prev.x, prev.y); cx.lineTo(p.x, p.y); cx.stroke();
        prev = p;
      }
      cx.lineCap = 'butt';
      const d = SPRR * 2 * (0.2 + sat.s * 0.1) * head.k;
      cx.globalAlpha = dim * SA;
      cx.drawImage(SPR[SPRN - 3], head.x - d / 2, head.y - d / 2, d, d);
      cx.globalAlpha = SA;
    }
    cx.globalCompositeOperation = 'source-over';
  }

  /* 字母刻度环：球外一圈细环，像浑天仪的刻度。26 个字母均匀排开，
     刻度的长短和亮度 = 这个字母点亮了多少，跟词树里字母节点的金弧是一回事。
     跟着球慢慢转，但不跟着缩放抖动 */
  const ABC = 'abcdefghijklmnopqrstuvwxyz';
  function drawDial() {
    const X = PROJ.cx, Y = PROJ.cy, R = PROJ.r * 1.17;
    const rot = -Math.PI / 2 + sphere.yaw * 0.35;
    cx.lineWidth = 1;
    cx.strokeStyle = 'rgba(220,196,150,.16)';
    cx.beginPath(); cx.arc(X, Y, R, 0, 6.283); cx.stroke();
    // 细分刻度
    cx.beginPath();
    for (let i = 0; i < 130; i++) {
      if (i % 5 === 0) continue;
      const a = rot + (i / 130) * 6.283;
      cx.moveTo(X + Math.cos(a) * R, Y + Math.sin(a) * R);
      cx.lineTo(X + Math.cos(a) * (R + 3), Y + Math.sin(a) * (R + 3));
    }
    cx.strokeStyle = 'rgba(220,196,150,.14)';
    cx.stroke();
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.font = 'italic 11px Georgia, serif';
    for (let i = 0; i < 26; i++) {
      const L = LETTERS[ABC[i]];
      const f = L ? L.lit / L.n : 0;
      const a = rot + (i / 26) * 6.283;
      const c = Math.cos(a), sn = Math.sin(a);
      cx.lineWidth = 1.2;
      cx.strokeStyle = `rgba(236,200,140,${0.22 + 0.55 * f})`;
      cx.beginPath();
      cx.moveTo(X + c * R, Y + sn * R);
      cx.lineTo(X + c * (R + 5 + 9 * f), Y + sn * (R + 5 + 9 * f));
      cx.stroke();
      cx.fillStyle = `rgba(236,224,204,${0.28 + 0.45 * f})`;
      cx.fillText(ABC[i], X + c * (R + 24), Y + sn * (R + 24));
    }
    cx.textBaseline = 'alphabetic';
  }

  function drawGrid() {
    cx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ring(-Math.PI / 2 + (i / 6) * Math.PI, 44, 0);
      cx.strokeStyle = 'rgba(140,170,205,.055)';
      cx.stroke();
    }
    for (let m = 0; m < 8; m++) {
      const lo = (m / 8) * Math.PI * 2;
      let started = false;
      cx.beginPath();
      for (let k = 0; k <= 30; k++) {
        const la = -Math.PI / 2 + (k / 30) * Math.PI;
        const cl = Math.cos(la);
        const p = project({ x: cl * Math.sin(lo), y: Math.sin(la), z: cl * Math.cos(lo) });
        if (p.z < 0) { started = false; continue; }
        if (!started) { cx.moveTo(p.x, p.y); started = true; } else cx.lineTo(p.x, p.y);
      }
      cx.strokeStyle = 'rgba(140,170,205,.045)';
      cx.stroke();
    }
  }

  function setHover(s) {
    if (s === hover) { if (s) onHover(s.w, s._p); return; }
    hover = s;
    cv.style.cursor = s ? 'pointer' : 'default';
    onHover(s ? s.w : null, s ? s._p : null);
  }

  /* ---------------- 交互：鼠标 + 触屏 ---------------- */

  let drag = null;
  const touches = new Map();
  let pinch = null;

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: tzoom, zt: tzoomT };
      drag = null;
      return;
    }
    mouse = { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    drag = { x: e.clientX, y: e.clientY, yaw: sphere.tyaw, pitch: sphere.tpitch, px: tpan.x, py: tpan.y, moved: 0 };
  });
  cv.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const f = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
      if (view === 'tree') tzoomT = Math.max(0.6, Math.min(12, pinch.zt * f));
      else tzoom = Math.max(0.55, Math.min(3.2, pinch.z * f));
      return;
    }
    if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY };
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (view === 'tree') {
      const kk = TS() * zoomT;
      pan.x = tpan.x = drag.px + dx / kk;
      pan.y = tpan.y = drag.py + dy / kk;
      return;
    }
    sphere.tyaw = drag.yaw + dx * 0.006;
    // 俯仰夹住，翻过极点会天旋地转
    sphere.tpitch = Math.max(-1.25, Math.min(1.25, drag.pitch + dy * 0.006));
    sphere.yaw = sphere.tyaw; sphere.pitch = sphere.tpitch;
  });
  const up = e => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && drag.moved < 6) {
      // 触屏没有悬停：点下去的那一刻才知道点的是哪颗
      if (mouse && mouse.touch) {
        requestAnimationFrame(() => { if (hoverCandidate) onPick(hoverCandidate.w); mouse = null; });
      } else if (hover) onPick(hover.w);
    } else if (mouse && mouse.touch) mouse = null;
    drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') mouse = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (view === 'tree') {
      // 以鼠标所在的点为中心缩放：鼠标下面那颗星不动
      const k0 = TS() * zoomT;
      const wx = (e.clientX - W / 2) / k0 - pan.x, wy = (e.clientY - H / 2) / k0 - pan.y;
      zoomT = tzoomT = Math.max(0.6, Math.min(12, tzoomT * (e.deltaY < 0 ? 1.18 : 0.85)));
      const k1 = TS() * zoomT;
      pan.x = tpan.x = (e.clientX - W / 2) / k1 - wx;
      pan.y = tpan.y = (e.clientY - H / 2) / k1 - wy;
      return;
    }
    tzoom = Math.max(0.55, Math.min(3.2, tzoom * (e.deltaY < 0 ? 1.14 : 0.88)));
  }, { passive: false });

  addEventListener('resize', () => { resize(); if (view === 'tree') layoutTree(); else treeDirty = true; });

  function start() {
    bakeSprites();
    makeDust();
    resize();
    requestAnimationFrame(frame);
  }

  return {
    start, set, setBright, focus, focusNewest,
    zoom: z => { tzoom = z; },
    view: setView,
    viewName: () => view,
    pause: v => { paused = v; },
    onPick: f => { onPick = f; },
    onHover: f => { onHover = f; },
    count: () => stars.filter(s => !s.ghost).length,
    links: () => links.length,
    has: w => byName.has(w),
  };
})();
