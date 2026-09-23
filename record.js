/* 星词 · 记录：每一次评分、点亮都记一笔。按天回看、错词本、这一周，能复查，能导出成 Markdown。
 * 只记事实，不催：没有配额，没有连续天数，没有落后提醒。 */
'use strict';

const LKEY = 'xingci.log.v1';
/* 一条记录：[时间, 词, 动作, 之后的等级, 来源]
 * 动作：2 记得 / 1 模糊 / 0 忘了 / 'L' 点亮 / 'K' 早就认识 / 'X' 不用再抽
 *       'P' 有记录以前的最后一次复习，只知道时间和当时的等级，不知道结果
 * 来源：c 主窗口 / f 浮窗 / o 有记录以前的旧存档 */
const ACT = { 2: '记得', 1: '模糊', 0: '忘了', L: '点亮', K: '早就认识', X: '不用再抽' };
const WEEKDAY = '日一二三四五六';

let logFail = false;
let LOG = loadLog();

function loadLog() {
  try {
    const d = JSON.parse(store.get(LKEY));
    if (d && Array.isArray(d.ev)) return { v: 1, ev: d.ev, shows: d.shows || {} };
  } catch (e) { /* 没有或读坏了就从进度里补 */ }
  const log = backfill();
  if (log.ev.length) saveLog(log);
  return log;
}

/* 有记录以前的进度：点亮时间是准的，评分过程没留下，只剩「最后一次」 */
function backfill() {
  const ev = S.sky.map(x => [x.t, x.w, 'L', null, 'o']);
  for (const [w, p] of Object.entries(S.prog)) {
    if (p.last && p.n) ev.push([p.last, w, 'P', p.lv, 'o']);
  }
  ev.sort((a, b) => a[0] - b[0]);
  return { v: 1, ev, shows: {} };
}

function saveLog(log = LOG) {
  try { store.set(LKEY, JSON.stringify(log)); logFail = false; }
  catch (e) { logFail = true; }
}
// 一次点亮一整本书会连记上千条，攒到这一轮代码跑完再写一次文件
let logDirty = false;
function queueSave() {
  if (logDirty) return;
  logDirty = true;
  Promise.resolve().then(() => { logDirty = false; saveLog(); });
}

function logEv(w, a, src = 'c') {
  const p = S.prog[w];
  LOG.ev.push([Date.now(), w, a, p ? p.lv : null, src]);
  queueSave();
}
function logShown() {
  const d = dk(Date.now());
  LOG.shows[d] = (LOG.shows[d] || 0) + 1;
  queueSave();
}

/* ---------------- 统计 ---------------- */

function dk(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayName = d => { const t = new Date(d + 'T00:00'); return `${t.getMonth() + 1}月${t.getDate()}日 周${WEEKDAY[t.getDay()]}`; };
const shortDay = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

/* 按天汇总：res 是这个词当天最后一次的结果，lit 是当天点亮的 */
function days() {
  const m = new Map();
  const get = d => {
    if (!m.has(d)) m.set(d, { d, lit: [], res: new Map(), n: [0, 0, 0], known: 0, old: false, shows: LOG.shows[d] || 0 });
    return m.get(d);
  };
  for (const [t, w, a, , src] of LOG.ev) {
    if (a === 'P') continue;
    const r = get(dk(t));
    if (a === 'L' || a === 'K') { r.lit.push(w); if (src === 'o') r.old = true; }
    else if (a === 'X') { r.known++; r.res.set(w, 'X'); }
    else { r.n[a]++; r.res.set(w, a); }
  }
  for (const d of Object.keys(LOG.shows)) get(d);
  return [...m.values()].sort((a, b) => a.d < b.d ? 1 : -1);
}

/* 错词本：忘过的词，现在还没记牢的排前面 */
function badWords() {
  return Object.entries(S.prog)
    .filter(([w, p]) => p.bad > 0 && inSky.has(w))
    .sort(([, a], [, b]) => (a.lv - b.lv) || (b.bad - a.bad) || (b.last - a.last))
    .map(([w, p]) => ({ w, lv: p.lv, bad: p.bad, known: !!p.known }));
}

function weekDays() {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) out.push(dk(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  return out;
}

function levelDist() {
  const c = { none: 0, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, known: 0 };
  for (const { w } of S.sky) {
    const p = S.prog[w];
    if (!p) c.none++; else if (p.known) c.known++; else c[Math.min(p.lv, 5)]++;
  }
  return c;
}

function timeline(w) {
  return LOG.ev.filter(e => e[1] === w);
}

/* ---------------- 卡片上的时间线 ---------------- */

function renderTL(w) {
  const el = $('tl');
  const evs = timeline(w);
  if (!evs.length) { el.style.display = 'none'; return; }
  const item = ([t, , a, lv, src]) => {
    if (a === 'P') return `<span>${shortDay(t)} 之前复习过 · L${lv}</span>`;
    const c = a === 2 ? 'g' : a === 1 ? 'm' : a === 0 ? 'b' : 'l';
    const lvTxt = typeof a === 'number' && lv !== null ? ` L${lv}` : '';
    return `<span class="${c}">${shortDay(t)} ${ACT[a]}${lvTxt}${src === 'f' ? '<i>浮窗</i>' : ''}</span>`;
  };
  const shown = evs.slice(-6);
  el.innerHTML = '记录　' + (evs.length > 6 ? '… ' : '') + shown.map(item).join(' → ');
  el.style.display = '';
}

/* ---------------- 面板 ---------------- */

let lTab = 'day';
const lOpen = new Set([dk(Date.now())]);

function renderLog() {
  document.querySelectorAll('#lTabs button[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === lTab));
  const el = $('lBody');
  if (lTab === 'day') el.innerHTML = renderDays();
  else if (lTab === 'bad') el.innerHTML = renderBad();
  else el.innerHTML = renderWeek();
  $('lWarn').style.display = logFail ? '' : 'none';
}

const chip = (w, c, extra = '') => `<span class="wc ${c}" data-w="${esc(w)}">${esc(w)}${extra}</span>`;
const resClass = a => a === 2 ? 'g' : a === 1 ? 'm' : a === 0 ? 'b' : a === 'X' ? 'k' : 'l';
const CHIP_MAX = 240;

function daySummary(r) {
  const parts = [];
  if (r.lit.length) parts.push(`点亮 ${r.lit.length}`);
  const g = r.n[0] + r.n[1] + r.n[2];
  if (g) parts.push(`评分 ${g}（<b class="g">记得 ${r.n[2]}</b> · <b class="m">模糊 ${r.n[1]}</b> · <b class="b">忘了 ${r.n[0]}</b>）`);
  if (r.known) parts.push(`不用再抽 ${r.known}`);
  if (r.shows) parts.push(`浮窗弹过 ${r.shows}`);
  return parts.join('　') || '只开过浮窗';
}

function dayWords(r) {
  // 复查顺序：忘了、模糊在前，记得的其次，只点亮没评过的最后
  const rank = w => { const a = r.res.get(w); return a === 0 ? 0 : a === 1 ? 1 : a === 2 ? 2 : 3; };
  const all = [...new Set([...r.res.keys(), ...r.lit])];
  return all.sort((a, b) => rank(a) - rank(b));
}

function renderDays() {
  const list = days();
  if (!list.length) return '<p class="hint">还没有记录。抽一轮之后，每一次评分都会记在这里。</p>';
  return list.map(r => {
    const open = lOpen.has(r.d);
    const ws = dayWords(r);
    let body = '';
    if (open) {
      // 评过分的直接摆出来；只点亮没评过的收进折叠里，一次点亮一整批时才不会把评分淹掉
      const rated = ws.filter(w => r.res.has(w));
      const litOnly = ws.filter(w => !r.res.has(w));
      const chips = list => list.slice(0, CHIP_MAX).map(w => chip(w, resClass(r.res.has(w) ? r.res.get(w) : 'L'))).join('') +
        (list.length > CHIP_MAX ? `<span class="more">还有 ${list.length - CHIP_MAX} 个，导出能看到全部</span>` : '');
      body = `<div class="dbody">
        ${rated.length ? `<div class="chips">${chips(rated)}</div>` : ''}
        ${litOnly.length ? `<details${rated.length ? '' : ' open'}><summary>只点亮、还没评过的 ${litOnly.length} 个</summary><div class="chips">${chips(litOnly)}</div></details>` : ''}
        ${r.old ? '<p class="hint">这天的点亮时间来自开始记录以前的存档，当时的评分没有留下。</p>' : ''}
        <div class="acts">${rated.length && litOnly.length ? `<button data-rev="${r.d}|rated">复查评过的（${rated.length} 个）</button>` : ''}${ws.length ? `<button data-rev="${r.d}">复查这一天全部（${ws.length} 个）</button>` : ''}<span class="sp"></span><button data-exp="${r.d}">导出这天</button></div>
      </div>`;
    }
    return `<div class="day${open ? ' open' : ''}" data-d="${r.d}">
      <div class="dh"><b>${dayName(r.d)}</b><span>${daySummary(r)}</span></div>${body}</div>`;
  }).join('');
}

function renderBad() {
  const list = badWords();
  if (!list.length) return '<p class="hint">还没有忘过的词。评分时点过「忘了」的词会出现在这里。</p>';
  const weak = list.filter(x => x.lv <= 1 && !x.known);
  return `<p class="hint">忘过的词都在这，现在还没记牢（L0、L1）的排在前面。数字是一共忘过几次。</p>
    <div class="chips">${list.map(x => chip(x.w, x.lv <= 1 && !x.known ? 'b' : 'g', `<i>×${x.bad} · L${x.lv}</i>`)).join('')}</div>
    <div class="acts">${weak.length ? `<button data-rev="bad">复查还没记牢的（${weak.length} 个）</button>` : ''}<span class="sp"></span><button data-exp="bad">导出错词本</button></div>`;
}

function weekStats() {
  const wd = weekDays();
  const set = new Set(wd);
  const byDay = new Map(days().filter(r => set.has(r.d)).map(r => [r.d, r]));
  const forgot = new Set();
  for (const [t, w, a] of LOG.ev) if (a === 0 && set.has(dk(t))) forgot.add(w);
  return { wd, byDay, forgot: [...forgot] };
}

function renderWeek() {
  const { wd, byDay, forgot } = weekStats();
  // 条只画评分：一次点亮一整本书会有上千个，混进来评分那几段就看不见了
  const max = Math.max(1, ...wd.map(d => { const r = byDay.get(d); return r ? r.n[0] + r.n[1] + r.n[2] : 0; }));
  const rows = wd.map(d => {
    const r = byDay.get(d);
    const n = r ? r.n : [0, 0, 0];
    const seg = (v, c) => v ? `<span class="${c}" style="width:${v / max * 100}%"></span>` : '';
    return `<div class="wrow"><b>${dayName(d).replace(/^\d+月/, '')}</b>
      <div class="wbar">${seg(n[2], 'g')}${seg(n[1], 'm')}${seg(n[0], 'b')}</div>
      <span>${r ? daySummary(r) : ''}</span></div>`;
  }).join('');
  const c = levelDist();
  const tot = Math.max(1, S.sky.length);
  const LV = [['none', '没测过'], [0, '忘了'], [1, 'L1'], [2, 'L2'], [3, 'L3'], [4, 'L4'], [5, 'L5'], ['known', '不用再抽']];
  const dist = LV.map(([k, name]) => c[k] ? `<span class="lv${k}" style="flex:${c[k] / tot}" title="${name} ${c[k]}"></span>` : '').join('');
  const legend = LV.filter(([k]) => c[k]).map(([k, name]) => `<span><i class="lv${k}"></i>${name} ${c[k]}</span>`).join('');
  const stillBad = forgot.filter(w => lvOf(w) === 0);
  return `<div class="week">${rows}</div>
    <h4>现在星空里的等级</h4>
    <div class="dist">${dist}</div><div class="legend">${legend}</div>
    <h4>这周忘过的（${forgot.length}）</h4>
    ${forgot.length ? `<div class="chips">${forgot.map(w => chip(w, lvOf(w) === 0 ? 'b' : 'g', `<i>L${lvOf(w)}</i>`)).join('')}</div>
      <p class="hint">红的是现在还是 L0 的，绿的是后来又记住了。</p>` : '<p class="hint">这周还没有忘过的词。</p>'}
    <div class="acts">${stillBad.length ? `<button data-rev="week">复查这周还没记住的（${stillBad.length} 个）</button>` : ''}<span class="sp"></span><button data-exp="week">导出本周</button></div>`;
}

/* ---------------- 复查 ---------------- */

function reviewWords(key) {
  if (key === 'bad') return badWords().filter(x => x.lv <= 1 && !x.known).map(x => x.w);
  if (key === 'week') return weekStats().forgot.filter(w => lvOf(w) === 0);
  const [d, only] = key.split('|');
  const r = days().find(x => x.d === d);
  if (!r) return [];
  return only === 'rated' ? dayWords(r).filter(w => r.res.has(w)) : dayWords(r);
}
const reviewLabel = key => key === 'bad' ? '复查错词' : key === 'week' ? '复查本周' : `复查 ${shortDay(new Date(key.split('|')[0] + 'T00:00'))}`;

/* ---------------- 导出 Markdown ---------------- */

function mdWord(w, tail) {
  const e = entry(w);
  return `- **${w}**` + (e && e[1] ? ` /${e[1]}/` : '') + (e ? ` ${XC.brief(e[2])}` : '') + (tail ? ` — ${tail}` : '');
}
const nowLv = w => { const p = S.prog[w]; return !p ? '没测过' : p.known ? '不用再抽' : `现在 L${p.lv}`; };

function dayMd(d) {
  const r = days().find(x => x.d === d) || { d, lit: [], res: new Map(), n: [0, 0, 0], known: 0, shows: LOG.shows[d] || 0 };
  const out = [`# 星词 · ${d} 周${WEEKDAY[new Date(d + 'T00:00').getDay()]}`, ''];
  out.push(daySummary(r).replace(/<[^>]+>/g, ''), '');
  const group = (title, a) => {
    const ws = [...r.res].filter(([, x]) => x === a).map(([w]) => w);
    if (!ws.length) return;
    out.push(`## ${title}（${ws.length}）`, '');
    for (const w of ws) out.push(mdWord(w, nowLv(w) + (a === 0 ? `，一共忘过 ${S.prog[w] ? S.prog[w].bad : 0} 次` : '')));
    out.push('');
  };
  group('忘了', 0); group('模糊', 1); group('记得', 2); group('不用再抽', 'X');
  if (r.lit.length) {
    out.push(`## 新点亮（${r.lit.length}）`, '');
    for (const w of r.lit) out.push(mdWord(w));
    out.push('');
  }
  return out.join('\n');
}

function badMd() {
  const list = badWords();
  const out = [`# 星词 · 错词本（${dk(Date.now())}）`, '', `一共 ${list.length} 个忘过的词，没记牢的在前。`, ''];
  for (const x of list) out.push(mdWord(x.w, `忘过 ${x.bad} 次，${nowLv(x.w)}`));
  return out.join('\n') + '\n';
}

function weekMd() {
  const { wd, byDay, forgot } = weekStats();
  const out = [`# 星词 · 本周（${wd[0]} – ${wd[6]}）`, '', '| 日期 | 点亮 | 记得 | 模糊 | 忘了 | 浮窗弹过 |', '|---|---|---|---|---|---|'];
  for (const d of wd) {
    const r = byDay.get(d);
    out.push(`| ${dayName(d)} | ${r ? r.lit.length : 0} | ${r ? r.n[2] : 0} | ${r ? r.n[1] : 0} | ${r ? r.n[0] : 0} | ${r ? r.shows : 0} |`);
  }
  const c = levelDist();
  out.push('', '## 现在星空里的等级', '',
    `${S.sky.length} 颗星：没测过 ${c.none} · 忘了 ${c[0]} · L1 ${c[1]} · L2 ${c[2]} · L3 ${c[3]} · L4 ${c[4]} · L5 ${c[5]} · 不用再抽 ${c.known}`, '');
  out.push(`## 这周忘过的（${forgot.length}）`, '');
  for (const w of forgot) out.push(mdWord(w, nowLv(w)));
  return out.join('\n') + '\n';
}

async function exportText(name, text) {
  const D = window.xingciDesktop;
  if (D && D.exportFile) {
    const f = await D.exportFile(name, text);
    toast(f ? `导出到 ${f}` : '导出失败');
    return f;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}
function exportMd(key) {
  if (key === 'bad') return exportText(`星词-错词本-${dk(Date.now())}.md`, badMd());
  if (key === 'week') return exportText(`星词-本周-${dk(Date.now())}.md`, weekMd());
  return exportText(`星词-${key}.md`, dayMd(key));
}

/* ---------------- 事件 ---------------- */

$('bLog').onclick = () => openPanel('log');
$('lTabs').onclick = e => {
  const b = e.target.closest('button[data-t]');
  if (b) { lTab = b.dataset.t; renderLog(); }
};
$('lBody').onclick = e => {
  const t = e.target;
  const wc = t.closest('.wc');
  if (wc) { closePanel(); peek(wc.dataset.w); return; }
  if (t.dataset.rev) { reviewRound(reviewWords(t.dataset.rev), reviewLabel(t.dataset.rev)); return; }
  if (t.dataset.exp) { exportMd(t.dataset.exp); return; }
  const dh = t.closest('.dh');
  if (dh) {
    const d = dh.parentNode.dataset.d;
    if (lOpen.has(d)) lOpen.delete(d); else lOpen.add(d);
    renderLog();
  }
};
