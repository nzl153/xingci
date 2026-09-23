/* 星词浮窗：隔一段时间从星空里抽一个词弹出来。
 * 不抢焦点。先只给词，4 秒后再出释义，算一次很轻的回忆；想记一笔就点「记得/忘了」。
 * 进度每次抽词时从存档文件现读，主窗口评过分这里马上生效。
 * 点胶囊只是提前看释义，双击才打开主窗口——单击就弹大窗口太打扰。
 */
'use strict';

const $ = id => document.getElementById(id);
const api = window.floatApi;
const ROWS = window.XC_DICT.rows;
const IDX = new Map(ROWS.map((r, i) => [r[0], i]));
const HKEY = 'xingci.float.hist';
const MEANING_DELAY = 4000;
const LEAVE = 180;

let interval = 60, on = true, autoSay = false, volume = 0.75;
let hist = [];
try { hist = JSON.parse(XC.store.get(HKEY)) || []; } catch { hist = []; }
let pos = hist.length - 1;
let hovering = false;
let tickT = 0, meanT = 0, swapT = 0;
const graded = new Map();          // 第几次弹出 -> 评了什么，同一次出现只记一次
let base = 0;                      // 历史被截掉的条数，让 base + pos 在截断后仍然指向同一次弹出

function state() {
  try { return JSON.parse(XC.store.get('xingci.v1')); } catch { return null; }
}
const accent = () => { const S = state(); return (S && S.accent) || 'us'; };
const say = w => XC.say(w, accent(), volume);
// 评分音效：主窗口设置里的音效大小，再乘上胶囊自己的音量
const sfx = kind => { const S = state(); XC.sfx(kind, (S && S.sfx != null ? S.sfx : 0.5) * volume); };

function pick() {
  const S = state();
  if (!S || !S.sky || !S.sky.length) return null;
  const recent = new Set(hist.slice(-15));
  return XC.pick(S.sky, S.prog, w => recent.has(w) || !IDX.has(w));
}

/* 星星颜色跟熟练度走：忘了偏暗蓝，没测过浅蓝，L1 起从米白一路暖到金 */
function levelOf(w) {
  const S = state();
  const p = S && S.prog[w];
  return p ? p.lv : null;
}
function levelColor(lv) {
  if (lv === null) return '#9fb3c8';
  if (!lv) return '#6f86a0';
  return ['#ded6c8', '#ecd9b4', '#f0cf8e', '#f2c26c', '#f5b54a'][Math.min(lv, 5) - 1];
}

const nextFrame = f => requestAnimationFrame(() => requestAnimationFrame(f));

/* 换词：旧词先淡出，换好内容后胶囊宽度平滑过渡到新词的宽度，再淡入 */
function render(isNew) {
  const cap = $('cap');
  const w = hist[pos];
  if (!w) { cap.classList.add('hide'); return; }
  $('pos').textContent = pos < hist.length - 1 ? `${pos + 1} / ${hist.length}` : '';
  $('prev').disabled = pos <= 0;
  gradeUI();
  clearTimeout(meanT); clearTimeout(swapT);

  const apply = () => {
    const e = ROWS[IDX.get(w)];
    const w0 = cap.getBoundingClientRect().width;
    $('word').textContent = w;
    $('ipa').textContent = e && e[1] ? `/${e[1]}/` : '';
    $('cn').textContent = e ? XC.brief(e[2]) : '';
    $('star').style.color = levelColor(levelOf(w));
    // 翻回去看的是之前弹过的词，直接给释义
    cap.classList.toggle('meaning', !isNew);
    cap.style.width = 'auto';
    const w1 = cap.getBoundingClientRect().width;
    if (w0 && Math.abs(w1 - w0) > 1) {
      cap.style.width = w0 + 'px';
      void cap.offsetWidth;
      cap.style.width = w1 + 'px';
    } else cap.style.width = '';
  };

  if (cap.classList.contains('hide')) {
    cap.classList.remove('hide');
    cap.classList.add('enter');
    apply();
    nextFrame(() => cap.classList.remove('enter'));
  } else {
    cap.classList.add('leave');
    swapT = setTimeout(() => { apply(); cap.classList.remove('leave'); }, LEAVE);
  }
  if (isNew) {
    meanT = setTimeout(showMeaning, MEANING_DELAY + LEAVE);
    if (autoSay) say(w);
  }
}
$('cap').addEventListener('transitionend', e => {
  if (e.target === e.currentTarget && e.propertyName === 'width') e.currentTarget.style.width = '';
});

function showMeaning() {
  clearTimeout(meanT);
  $('cap').classList.add('meaning');
}

/* ---------- 评分：交给主窗口记，这里只负责让你看见结果 ---------- */

function gradeUI() {
  const g = graded.get(base + pos);
  $('good').disabled = $('bad').disabled = g !== undefined;
  $('good').classList.toggle('done', g && g.g === 2);
  $('bad').classList.toggle('done', g && g.g === 0);
  $('good').textContent = g && g.g === 2 ? `✓ 记得 · ${g.msg}` : '✓ 记得';
  $('bad').textContent = g && g.g === 0 ? `✗ 忘了 · ${g.msg}` : '✗ 忘了';
}

function grade(g) {
  const w = hist[pos], at = base + pos;
  if (!w || graded.has(at)) return;
  const lv0 = levelOf(w) || 0;
  graded.set(at, { g, msg: '…' });
  api.grade(w, g);
  sfx(g === 2 ? 'good' : 'bad');
  const star = $('star');
  star.classList.remove('pop', 'sink');
  void star.offsetWidth;
  star.classList.add(g === 2 ? 'pop' : 'sink');
  showMeaning();
  gradeUI();
  // 主窗口存完再读回来，确认真的记上了
  setTimeout(() => {
    const lv = levelOf(w);
    const rec = graded.get(at);
    if (rec) rec.msg = lv === null ? '没记上' : g === 2 ? (lv > lv0 ? `L${lv0}→L${lv}` : `L${lv}`) : '归零';
    if (hist[pos] === w) { gradeUI(); $('star').style.color = levelColor(lv); }
  }, 400);
}

function fresh() {
  const w = pick();
  if (!w) { if (!hist.length) $('cap').classList.add('hide'); return; }
  hist.push(w);
  if (hist.length > 60) { base += hist.length - 60; hist = hist.slice(-60); }
  pos = hist.length - 1;
  try { XC.store.set(HKEY, JSON.stringify(hist)); } catch { /* 存不了就只留在内存里 */ }
  render(true);
}

/* 手动翻过之后重新计时，不然刚翻回去看，下一秒就被新词顶掉 */
function schedule() {
  clearTimeout(tickT);
  if (!on) return;
  tickT = setTimeout(function tick() {
    // 鼠标停在上面、或者人不在电脑前，就先别换，不然回来时历史全是没看过的词
    if (hovering || api.away()) { tickT = setTimeout(tick, 5000); return; }
    fresh();
    schedule();
  }, interval * 1000);
}

/* 第一次收到配置、或者从关着被重新打开时，马上弹一个新的；只是改了间隔就接着计时 */
let wasOn = false;
const IVS = [15, 30, 60, 180];
const ivLabel = s => s < 60 ? s + 's' : s / 60 + 'm';
api.onCfg(c => {
  interval = c.interval; on = c.on; autoSay = c.autoSay;
  $('auto').classList.toggle('is-on', autoSay);
  $('auto').title = autoSay ? '自动朗读已开：点一下关掉' : '自动朗读已关：点一下打开，每弹一个词读一遍';
  $('iv').textContent = ivLabel(interval);
  volume = c.volume;
  volUI();
  if (on && !wasOn) fresh();
  wasOn = on;
  schedule();
});

/* ---------- 鼠标：单击=看释义，双击=打开卡片，拖=挪位置 ---------- */

const cap = $('cap');
cap.addEventListener('mouseenter', () => {
  hovering = true;
  api.mouse(true);
  // 鼠标移上来多半要点喇叭，先把发音拉下来；只挂着不看就一点流量都不花
  if (hist[pos]) XC.prefetch(hist[pos], accent());
});
cap.addEventListener('mouseleave', () => { hovering = false; api.mouse(false); });

let down = null;
cap.addEventListener('pointerdown', e => {
  if (e.target.closest('#ctl, #grade, #say')) return;
  cap.setPointerCapture(e.pointerId);
  down = { sx: e.screenX, sy: e.screenY, moved: 0 };
  api.drag({ start: true, sx: e.screenX, sy: e.screenY });
  cap.style.cursor = 'grabbing';
});
cap.addEventListener('pointermove', e => {
  if (!down) return;
  down.moved = Math.max(down.moved, Math.abs(e.screenX - down.sx) + Math.abs(e.screenY - down.sy));
  if (down.moved > 3) api.drag({ sx: e.screenX, sy: e.screenY });
});
cap.addEventListener('pointerup', e => {
  if (!down) return;
  if (down.moved > 3) api.drag({ sx: e.screenX, sy: e.screenY, end: true });
  else showMeaning();
  down = null;
  cap.style.cursor = '';
});
cap.addEventListener('dblclick', e => {
  if (e.target.closest('#ctl, #grade, #say')) return;
  if (hist[pos]) api.open(hist[pos]);
});

$('prev').onclick = () => { if (pos > 0) { pos--; render(false); schedule(); } };
$('next').onclick = () => {
  if (pos < hist.length - 1) { pos++; render(false); }
  else fresh();
  schedule();
};
$('off').onclick = () => api.off();
$('good').onclick = () => grade(2);
$('bad').onclick = () => grade(0);
$('say').onclick = () => { if (hist[pos]) say(hist[pos]); };
$('auto').onclick = () => {
  api.autoSay(!autoSay);
  if (!autoSay && hist[pos]) say(hist[pos]);    // 刚打开时读一下当前这个，确认有声音
};

/* 音量：点一下循环四档，滚轮也能调；换档时响一声，听得出多大 */
const VOLS = [0.25, 0.5, 0.75, 1];
function volUI() {
  const i = VOLS.indexOf(volume);
  $('vol').dataset.lv = i < 0 ? 2 : i;
  $('volN').textContent = Math.round(volume * 100);
  $('vol').title = `浮窗音量 ${Math.round(volume * 100)}%：点一下换档，也可以滚轮`;
}
function setVolume(v) {
  volume = v;
  volUI();
  api.volume(v);
  XC.sfx('mid', v);
}
$('vol').onclick = () => setVolume(VOLS[(VOLS.indexOf(volume) + 1) % VOLS.length]);
$('vol').addEventListener('wheel', e => {
  e.preventDefault();
  const i = Math.max(0, VOLS.indexOf(volume));
  const j = Math.max(0, Math.min(VOLS.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
  if (j !== i) setVolume(VOLS[j]);
}, { passive: false });
$('iv').onclick = () => api.interval(IVS[(IVS.indexOf(interval) + 1) % IVS.length]);
