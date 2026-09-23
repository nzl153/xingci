/* 星词 · 主逻辑
 *
 * 星空 = 你点亮过的词，按点亮先后排。新词从「当前词书」按顺序来，每轮带几个。
 * 一轮 10 个，抽完必停给出口——「点开看两个」不能变成不知不觉刷半小时。
 * 没有打卡、没有每日任务、没有连续天数。
 */
'use strict';

const $ = id => document.getElementById(id);
const ROUND = 10;
const KEY = 'xingci.v1';
const TKEY = 'xingci.texts.v1';

/* ---------------- 词典 ---------------- */

const DICT = window.XC_DICT;
const ROWS = DICT.rows;                      // [w, ipa, cn, tagMask, rank]
const IDX = new Map(ROWS.map((r, i) => [r[0], i]));
const LEMMA = DICT.lemma;                     // 屈折形式 -> 原形下标
const ALPHA = ROWS.map(r => r[0]).sort();
const FORMS = new Map();                      // 原形下标 -> 屈折形式
for (const f in LEMMA) {
  const i = LEMMA[f];
  if (!FORMS.has(i)) FORMS.set(i, []);
  FORMS.get(i).push(f);
}
const TAG_NAME = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', ielts: '雅思', toefl: '托福', gre: 'GRE' };

function entry(w) { const i = IDX.get(w); return i === undefined ? null : ROWS[i]; }

/* 用户输入 -> 词典里的原形。went -> go，Studies -> study */
function resolve(raw) {
  const w = raw.toLowerCase().replace(/[’`]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!w) return null;
  if (IDX.has(w)) return w;
  if (w in LEMMA) return ROWS[LEMMA[w]][0];
  return null;
}

/* 词书：内置书 + 按考试标签从词典里现生成（按词频排） */
const BOOKS = (() => {
  const out = (window.XC_BOOKS || []).map(b => ({ id: b.id, name: b.name, words: b.words }));
  DICT.tags.forEach((t, bit) => {
    if (t === 'zk' || t === 'gk') return;
    const words = [];
    ROWS.forEach(r => { if (r[3] & (1 << bit)) words.push(r[0]); });
    out.push({ id: 'tag:' + t, name: TAG_NAME[t] + '词汇', words });
  });
  return out;
})();
const bookOf = id => BOOKS.find(b => b.id === id) || BOOKS[0];

/* ---------------- 存档 ---------------- */

function blank() {
  return { v: 1, sky: [], prog: {}, book: BOOKS[0].id, newN: 2, today: null, accent: 'us' };
}
const store = XC.store;

function load() {
  try {
    const s = JSON.parse(store.get(KEY));
    if (s && s.v === 1) return Object.assign(blank(), s);
  } catch (e) { /* 隐私窗口或被禁用时就当新用户 */ }
  return blank();
}
let S = load();
let TEXTS = [];
try { TEXTS = JSON.parse(store.get(TKEY)) || []; } catch (e) { TEXTS = []; }
let saveFail = false;
function save() {
  try { store.set(KEY, JSON.stringify(S)); saveFail = false; }
  catch (e) { saveFail = true; }
  stat();
}
function saveTexts() {
  try { store.set(TKEY, JSON.stringify(TEXTS)); return true; }
  catch (e) { return false; }
}

const inSky = new Set(S.sky.map(x => x.w));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayN = () => (S.today && S.today.d === today()) ? S.today.n : 0;
function bumpToday() { S.today = { d: today(), n: todayN() + 1 }; }

function lvOf(w) { const p = S.prog[w]; return p ? p.lv : 0; }
/* 忘了 < 没测过 < L1 < … < L5。没测过的夹在中间，比「忘了」亮，又不会比记得一次的还亮 */
function bright(w) {
  const p = S.prog[w];
  if (!p) return 0.34;
  return p.lv ? 0.42 + (Math.min(p.lv, 5) - 1) / 4 * 0.58 : 0.18;
}

function light(words, lv) {
  const t = Date.now();
  let n = 0;
  for (const w of words) {
    if (inSky.has(w) || !IDX.has(w)) continue;
    inSky.add(w);
    S.sky.push({ w, t });
    if (lv && !S.prog[w]) S.prog[w] = { lv, n: 0, bad: 0, last: 0 };
    n++;
  }
  if (n) refreshSky();
  return n;
}

function refreshSky() {
  const list = S.sky.map(x => ({ w: x.w, b: bright(x.w) }));
  // 当前词书里还没点亮的词先画成暗星，整颗球的样子从第一天就在
  for (const w of bookOf(S.book).words) if (!inSky.has(w)) list.push({ w, b: 0, ghost: true });
  // 暗星之间的同族连线也给过去：球上只画两头都亮的，词树要靠它们把同族抱成一团
  const has = new Set(list.map(x => x.w));
  const edges = [];
  for (const [a, b] of DICT.edges) {
    const wa = ROWS[a][0], wb = ROWS[b][0];
    if (has.has(wa) && has.has(wb)) edges.push([wa, wb]);
  }
  Sky.set(list, edges);
  stat();
}

/* 星球 ⇄ 词树 */
function setView(v, instant) {
  S.view = v;
  Sky.view(v, instant);
  $('bView').textContent = v === 'tree' ? '星球' : '词树';
  $('bView').title = (v === 'tree' ? '收拢成星球' : '摊开成词树') + '（T）';
}
function toggleView() { setView(S.view === 'tree' ? 'sphere' : 'tree'); save(); }

/* ---------------- 文章例句 ---------------- */

let TIDX = new Map();                         // 原形 -> [[文章下标, 句子]]
function indexTexts() {
  TIDX = new Map();
  TEXTS.forEach((t, ti) => {
    const sents = t.body.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+(?=["“(A-Z0-9])/);
    sents.forEach(sn => {
      const seen = new Set();
      for (const tok of sn.match(/[A-Za-z][A-Za-z'-]*/g) || []) {
        const low = tok.toLowerCase();
        const ws = [resolve(tok)];
        if (low in LEMMA) ws.push(ROWS[LEMMA[low]][0]);
        for (const w of ws) {
          if (!w || seen.has(w)) continue;
          seen.add(w);
          if (!TIDX.has(w)) TIDX.set(w, []);
          const L = TIDX.get(w);
          if (L.length < 6 && sn.length < 400) L.push([ti, sn]);
        }
      }
    });
  });
}

function surfaceRe(w) {
  const forms = [w, ...(FORMS.get(IDX.get(w)) || [])]
    .sort((a, b) => b.length - a.length)
    .map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // String.raw：普通字符串里的 '\b' 是退格符，正则会永远匹配不上
  return new RegExp(String.raw`\b(${forms.join('|')})\b`, 'ig');
}

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- 抽词 ---------------- */

let sess = { n: 0, g: [0, 0, 0], words: [], newLeft: 0, shown: new Set() };
let cur = null;            // { w, isNew }
let revealed = false;

function nextNew() {
  const b = bookOf(S.book);
  for (const w of b.words) if (!inSky.has(w) && !sess.shown.has(w)) return w;
  return null;
}

const pickOld = () => XC.pick(S.sky, S.prog, w => sess.shown.has(w));

function startRound() {
  closePanel();
  $('empty').classList.remove('on');
  const reviewable = S.sky.filter(x => !(S.prog[x.w] && S.prog[x.w].known)).length;
  // 星空太小时用新词补满一轮
  sess = { n: 0, g: [0, 0, 0], words: [], shown: new Set(),
           newLeft: Math.max(S.newN, ROUND - reviewable) };
  next();
}

function next() {
  const slots = ROUND - sess.n;
  let w = null, isNew = false;
  // 新词均匀插在一轮里，不要全堆在开头
  if (sess.newLeft > 0 && (Math.random() < sess.newLeft / slots || sess.newLeft >= slots)) {
    w = nextNew();
    if (w) isNew = true; else sess.newLeft = 0;
  }
  if (!w) w = pickOld();
  if (!w && sess.newLeft === 0) { w = nextNew(); isNew = !!w; }
  if (!w) {
    if (sess.n) wrapUp();
    else { stop(); toast('星空里没有可抽的词了。去「加词」或「词书」点亮一些吧。'); }
    return;
  }
  if (isNew) sess.newLeft--;
  sess.shown.add(w);
  show(w, isNew);
}

function show(w, isNew) {
  cur = { w, isNew };
  revealed = isNew;              // 新词没什么可回忆的，直接给释义
  const e = entry(w);
  const p = S.prog[w];
  const card = $('card');
  const bookPos = bookOf(S.book).words.indexOf(w);
  $('meta').innerHTML = isNew
    ? `<span class="newtag">新词</span>` + (bookPos >= 0 ? ` · ${esc(bookOf(S.book).name)} 第 ${bookPos + 1} 个` : '')
    : (p ? `L${p.lv} · 见过 ${p.n} 次` : '还没测过') + tagText(e);
  $('word').textContent = w;
  $('ipa').textContent = e && e[1] ? `/${e[1]}/` : '';
  $('cn').innerHTML = e ? e[2].split('\n').map(esc).join('<br>') : '';
  renderEx(w);
  renderFam(w);
  XC.prefetch(w, S.accent);
  card.classList.remove('reveal', 'wrap', 'isnew', 'solo');
  card.classList.toggle('isnew', isNew);
  if (revealed) card.classList.add('reveal');
  card.classList.add('on');
  $('round').textContent = sess.n >= 0 && sess.words
    ? `本轮 ${sess.n + 1} / ${ROUND}　·　今天 ${todayN()}` : '';
  Sky.pause(true);
  if (isNew && !Sky.has(w)) Sky.focusNewest(1.5); else Sky.focus(w, isNew ? 1.5 : 1.75);
}

/* 在星空里点一颗星：只看，不算进一轮 */
function peek(w) {
  if ($('card').classList.contains('on') && !$('card').classList.contains('solo') && sess.n > 0) return;
  sess = { n: 0, g: [0, 0, 0], words: [], shown: new Set([w]), newLeft: 0 };
  show(w, false);
  $('card').classList.add('solo');
  $('round').textContent = '从星图里点开的　·　评分照样记';
}

function tagText(e) {
  if (!e || !e[3]) return '';
  const t = DICT.tags.filter((_, i) => e[3] & (1 << i) && i >= 2).map(x => TAG_NAME[x]);
  return t.length ? ' · ' + t.join(' ') : '';
}

function renderEx(w) {
  const el = $('ex');
  const L = TIDX.get(w);
  if (!L || !L.length) { el.style.display = 'none'; return; }
  const [ti, sn] = L[Math.floor(Math.random() * L.length)];
  const t = TEXTS[ti];
  el.innerHTML = `<span class="src">你在「${esc(t.title)}」读到过</span>` +
                 esc(sn).replace(surfaceRe(w), '<em>$1</em>');
  el.style.display = '';
}

function renderFam(w) {
  const el = $('dv');
  const i = IDX.get(w);
  const fam = [];
  for (const [a, b] of DICT.edges) {
    if (a === i) fam.push(ROWS[b][0]); else if (b === i) fam.push(ROWS[a][0]);
  }
  if (!fam.length) { el.style.display = 'none'; return; }
  el.innerHTML = '同族　' + fam.slice(0, 6).map(f =>
    `<span class="${inSky.has(f) ? 'lit' : ''}">${esc(f)}</span>`).join('　·　');
  el.style.display = '';
}

function reveal() {
  revealed = true;
  $('card').classList.add('reveal');
}

function touch(w, g) {
  const p = S.prog[w] || { lv: 0, n: 0, bad: 0 };
  // 记得 +1，模糊不动，忘了归零
  p.lv = g === 2 ? Math.min(5, p.lv + 1) : g === 1 ? p.lv : 0;
  p.n++;
  if (g === 0) p.bad++;
  p.last = Date.now();
  delete p.known;
  S.prog[w] = p;
}

function grade(g) {
  if (!cur || !revealed || cur.isNew) return;
  const w = cur.w;
  const lv0 = lvOf(w);
  touch(w, g);
  if ($('card').classList.contains('solo')) toast(gradeMsg(w, lv0));
  after(w, g);
}

function gradeMsg(w, lv0) {
  const lv = lvOf(w);
  return lv > lv0 ? `${w}：L${lv0} → L${lv}，更亮了` : lv < lv0 ? `${w}：归零，之后会常出现` :
         lv === 0 ? `${w}：记下了，之后会常出现` : `${w}：保持 L${lv}`;
}

function lightCur(knew) {
  if (!cur || !cur.isNew) return;
  const w = cur.w;
  light([w], knew ? 3 : 0);
  if (!knew) S.prog[w] = { lv: 0, n: 1, bad: 0, last: Date.now() };
  else S.prog[w].last = Date.now();
  Sky.focus(w);
  after(w, knew ? 2 : -1);
}

function after(w, g) {
  Sky.setBright(w, bright(w), 1.2);
  bumpToday();
  if ($('card').classList.contains('solo')) { save(); stop(); return; }
  sess.n++;
  if (g >= 0) sess.g[g]++;
  sess.words.push({ w, g });
  save();
  if (sess.n >= ROUND) wrapUp(); else next();
}

function markKnown() {
  if (!cur || !revealed || cur.isNew) return;
  const w = cur.w;
  const p = S.prog[w] || { lv: 0, n: 0, bad: 0 };
  Object.assign(p, { lv: 5, known: true, last: Date.now() });
  p.n++;
  S.prog[w] = p;
  after(w, 2);
}

function wrapUp() {
  const [bad, mid, good] = sess.g;
  const lit = sess.words.filter(x => x.g === -1).length;
  $('rtitle').textContent = `这一轮 ${sess.n} 个 · 今天累计 ${todayN()} 个`;
  $('rnums').innerHTML =
    `<i>记得</i><b class="g">${good}</b>&nbsp;&nbsp;<i>模糊</i><b class="m">${mid}</b>&nbsp;&nbsp;` +
    `<i>忘了</i><b class="b">${bad}</b>` + (lit ? `&nbsp;&nbsp;<i>新点亮</i><b class="n">${lit}</b>` : '');
  const weak = sess.words.filter(x => x.g === 0 || x.g === 1).map(x => x.w);
  $('rwords').innerHTML = weak.length
    ? '没记牢：' + weak.map(w => `<em>${esc(w)}</em>`).join('　')
    : '这一轮全记得。';
  $('card').classList.remove('reveal', 'isnew');
  $('card').classList.add('wrap');
  cur = null;
  Sky.focus(null, 1.0);
}

function stop() {
  $('card').classList.remove('on', 'wrap', 'reveal', 'isnew', 'solo');
  cur = null; revealed = false;
  sess = { n: 0, g: [0, 0, 0], words: [], shown: new Set(), newLeft: 0 };
  Sky.pause(false);
  Sky.focus(null, 1);
}

/* ---------------- 发音 ---------------- */

function say(w) {
  XC.say(w, S.accent).then(ok => {
    if (!ok) toast(navigator.onLine ? '读不出来：有道那边没返回，系统里也没有英文语音。'
                                    : '没联网，系统里也没有英文语音，读不出来。');
  });
}

/* ---------------- 面板 ---------------- */

const PANELS = { add: '加词', book: '词书', text: '文章', set: '设置' };
let openP = null;
function openPanel(p) {
  if (openP === p) { closePanel(); return; }
  openP = p;
  $('pTitle').textContent = PANELS[p];
  document.querySelectorAll('#panel section').forEach(s => s.classList.toggle('on', s.dataset.p === p));
  $('panel').classList.add('on');
  if (p === 'add') { renderAdd(); setTimeout(() => $('aq').focus(), 30); }
  if (p === 'book') renderBooks();
  if (p === 'text') renderTexts();
  if (p === 'set') renderSet();
}
function closePanel() { openP = null; $('panel').classList.remove('on'); }

/* 加词：前缀补全，也认屈折形式 */
function lowerBound(q) {
  let lo = 0, hi = ALPHA.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ALPHA[m] < q) lo = m + 1; else hi = m; }
  return lo;
}
let aSel = 0, aItems = [];
function renderAdd() {
  const q = $('aq').value.trim().toLowerCase();
  aItems = [];
  if (q) {
    const exact = resolve(q);
    if (exact) aItems.push(exact);
    for (let i = lowerBound(q); i < ALPHA.length && aItems.length < 8; i++) {
      if (!ALPHA[i].startsWith(q)) break;
      if (!aItems.includes(ALPHA[i])) aItems.push(ALPHA[i]);
    }
  }
  aSel = Math.min(aSel, Math.max(0, aItems.length - 1));
  $('alist').innerHTML = aItems.length
    ? aItems.map((w, i) => {
        const e = entry(w);
        const on = inSky.has(w);
        return `<li data-w="${esc(w)}" class="${i === aSel ? 'sel' : ''} ${on ? 'on' : ''}">` +
               `<b>${esc(w)}</b><span>${esc(e[2].split('\n')[0])}</span>` +
               `<i>${on ? '已在星空' : '点亮'}</i></li>`;
      }).join('')
    : (q ? '<li class="none">词典里没有这个词</li>' : '');
}
function addWord(w) {
  if (!w) return;
  if (light([w], 0)) { Sky.focus(w, 1.6); Sky.setBright(w, bright(w), 1.4); toast(`点亮了 ${w}`); }
  else Sky.focus(w, 1.6);
  renderAdd();
}

function bulkParse(text) {
  const got = [], miss = [];
  const seen = new Set();
  for (const tok of text.match(/[A-Za-z][A-Za-z'’-]*/g) || []) {
    const w = resolve(tok);
    if (!w) { if (!miss.includes(tok)) miss.push(tok); continue; }
    if (!seen.has(w)) { seen.add(w); got.push(w); }
  }
  return { got, miss };
}

function renderBooks() {
  $('books').innerHTML = BOOKS.map(b => {
    const n = b.words.filter(w => inSky.has(w)).length;
    const pct = b.words.length ? n / b.words.length : 0;
    return `<div class="book ${b.id === S.book ? 'cur' : ''}" data-id="${b.id}">
      <div class="bt"><b>${esc(b.name)}</b><span>${n} / ${b.words.length}</span>
        ${b.id === S.book ? '<i>当前</i>' : '<button class="use">用这本</button>'}</div>
      <div class="bar"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
      <div class="bs">已学到第 <input type="number" min="0" max="${b.words.length}" step="50" value="${firstGap(b)}"> 个
        <button class="upto">把前面的都点亮</button></div>
    </div>`;
  }).join('');
  $('newN').value = S.newN;
  $('newNv').textContent = S.newN;
}
/* 书里从头数第一个还没点亮的位置 */
function firstGap(b) {
  const i = b.words.findIndex(w => !inSky.has(w));
  return i < 0 ? b.words.length : i;
}

function renderTexts() {
  $('tList').innerHTML = TEXTS.length
    ? TEXTS.map((t, i) => `<li data-i="${i}"><b>${esc(t.title)}</b><span>${t.body.length} 字符</span>` +
        `<button data-i="${i}" class="tdel">删除</button></li>`).join('')
    : '<li class="none">还没有文章。</li>';
}

/* ---------------- 阅读模式 ---------------- */

const bookSet = () => new Set(bookOf(S.book).words);

function kindOf(w, bs) {
  if (inSky.has(w)) return 'lit';
  return bs.has(w) ? 'todo' : 'dict';
}

/* rising 自己是词条，但 rise 已点亮或在词书里时，文里的 rising 应该算 rise */
function readerWord(tok, bs) {
  const w = resolve(tok);
  const low = tok.toLowerCase();
  if (!w || !(low in LEMMA)) return w;
  const lm = ROWS[LEMMA[low]][0];
  const known = x => inSky.has(x) || bs.has(x);
  return !known(w) && known(lm) ? lm : w;
}

function openReader(i) {
  const t = TEXTS[i];
  const bs = bookSet();
  $('rBody').innerHTML = t.body.split(/\n\s*\n|\r?\n/).filter(p => p.trim()).map(p => '<p>' +
    p.replace(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]|[^A-Za-z]+/g, tok => {
      if (!/^[A-Za-z]/.test(tok)) return esc(tok);
      const w = readerWord(tok, bs);
      return w ? `<span class="w ${kindOf(w, bs)}" data-w="${esc(w)}">${esc(tok)}</span>` : esc(tok);
    }) + '</p>').join('');
  $('rTitle').textContent = t.title;
  $('rBody').scrollTop = 0;
  readerStat();
  closePanel();
  $('reader').classList.add('on');
}

function readerStat() {
  const seen = { lit: new Set(), todo: new Set(), dict: new Set() };
  $('rBody').querySelectorAll('.w').forEach(el => seen[el.classList[1]].add(el.dataset.w));
  $('rStat').textContent = `已点亮 ${seen.lit.size} · 待点亮 ${seen.todo.size} · 其他 ${seen.dict.size}`;
  const b = $('rAll');
  b.textContent = seen.todo.size ? `点亮 ${seen.todo.size} 个词书词` : '词书词都点亮了';
  b.disabled = !seen.todo.size;
  b.dataset.words = [...seen.todo].join(' ');
}

/* 点亮后把文中同一个词的所有出现都改色 */
function repaint(words) {
  const set = new Set(words);
  $('rBody').querySelectorAll('.w').forEach(el => {
    if (set.has(el.dataset.w)) el.className = 'w lit';
  });
  readerStat();
}

function closeReader() {
  $('reader').classList.remove('on');
  hidePop();
}

let popW = null;
function showPop(el) {
  const w = el.dataset.w;
  popW = w;
  const e = entry(w);
  const p = S.prog[w];
  $('popW').textContent = w;
  $('popF').textContent = el.textContent.toLowerCase() !== w ? `（${el.textContent}）` : '';
  $('popIpa').textContent = e[1] ? `/${e[1]}/` : '';
  $('popCn').innerHTML = e[2].split('\n').slice(0, 3).map(esc).join('<br>');
  const on = inSky.has(w);
  $('popSt').textContent = on ? (p ? `已在星空 · L${p.lv}` : '已在星空 · 还没测过')
                              : (bookSet().has(w) ? '词书里的词' : '');
  $('popLight').style.display = on ? 'none' : '';
  $('popCard').style.display = on ? '' : 'none';
  const pop = $('pop');
  pop.classList.add('on');
  const r = el.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const x = Math.min(innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2));
  let y = r.bottom + 8;
  if (y + ph > innerHeight - 12) y = r.top - ph - 8;
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
}
function hidePop() { $('pop').classList.remove('on'); popW = null; }

function renderSet() {
  $('sAccent').value = S.accent;
  $('sAbout').innerHTML =
    `星词 v${XC.VERSION} · 词典 ${ROWS.length.toLocaleString()} 词，来自 <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noopener">ECDICT</a>（MIT）。` +
    (saveFail ? '<br><b class="warn">⚠ 最近一次保存失败了：浏览器存储可能被禁用或已满，记得导出备份。</b>' : '');
}

/* ---------------- 其他 UI ---------------- */

let toastT = 0;
function toast(msg) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2200);
}

function stat() {
  const n = S.sky.length;
  const solid = S.sky.filter(x => lvOf(x.w) >= 3).length;
  $('stat').innerHTML = n
    ? `<b>${n}</b> 颗星 · 记牢 <b>${solid}</b> · 星座 <b>${Sky.links()}</b> 条 · 今天 <b>${todayN()}</b>`
    : '';
}

Sky.onHover((w, p) => {
  const el = $('tip');
  if (!w) { el.classList.remove('on'); return; }
  const e = entry(w);
  const pr = S.prog[w];
  el.innerHTML = `<b>${esc(w)}</b><span>${esc(e ? e[2].split('\n')[0] : '')}</span>` +
                 `<span class="lv">${pr ? 'L' + pr.lv : '还没测过'}</span>`;
  el.style.left = Math.min(innerWidth - 270, p.x + 14) + 'px';
  el.style.top = Math.max(44, p.y - 34) + 'px';
  el.classList.add('on');
});
Sky.onPick(w => peek(w));

/* 首次打开 */
function renderEmpty() {
  $('eBook').innerHTML = BOOKS.map(b => `<option value="${b.id}">${esc(b.name)}（${b.words.length}）</option>`).join('');
  $('eBook').value = S.book;
  const upd = () => {
    const b = bookOf($('eBook').value);
    const n = Math.max(0, Math.min(b.words.length, +$('eCursor').value || 0));
    $('eHint').textContent = n ? `会点亮 ${n} 颗星` : '从零开始';
  };
  $('eBook').onchange = () => { S.book = $('eBook').value; refreshSky(); upd(); };
  $('eCursor').oninput = upd; upd();
  $('empty').classList.add('on');
}
$('eGo').onclick = () => {
  S.book = $('eBook').value;
  const b = bookOf(S.book);
  const n = Math.max(0, Math.min(b.words.length, +$('eCursor').value || 0));
  if (n) light(b.words.slice(0, n), 0);
  save();
  $('empty').classList.remove('on');
  if (!n) startRound();
};

/* ---------------- 事件 ---------------- */

$('bDraw').onclick = () => startRound();
$('bAdd').onclick = () => openPanel('add');
$('bBook').onclick = () => openPanel('book');
$('bText').onclick = () => openPanel('text');
$('bSet').onclick = () => openPanel('set');
$('bView').onclick = toggleView;
$('pClose').onclick = closePanel;
$('panel').onclick = e => { if (e.target === $('panel')) closePanel(); };

$('veil').onclick = reveal;
$('again').onclick = () => startRound();
$('done').onclick = () => stop();
$('stop').onclick = () => stop();
$('known').onclick = () => markKnown();
$('light').onclick = () => lightCur(false);
$('knew').onclick = () => lightCur(true);
$('say').onclick = () => cur && say(cur.w);
document.querySelectorAll('#grade button').forEach(b => { b.onclick = () => grade(+b.dataset.g); });

$('aq').oninput = () => { aSel = 0; renderAdd(); };
$('aq').onkeydown = e => {
  if (e.key === 'ArrowDown') { aSel = Math.min(aItems.length - 1, aSel + 1); renderAdd(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { aSel = Math.max(0, aSel - 1); renderAdd(); e.preventDefault(); }
  else if (e.key === 'Enter') { addWord(aItems[aSel]); $('aq').select(); }
};
$('alist').onclick = e => { const li = e.target.closest('li[data-w]'); if (li) addWord(li.dataset.w); };
$('abulk').oninput = () => {
  const { got, miss } = bulkParse($('abulk').value);
  const fresh = got.filter(w => !inSky.has(w)).length;
  $('abulkMsg').textContent = got.length
    ? `认出 ${got.length} 个，其中 ${fresh} 个是新的` + (miss.length ? `；${miss.length} 个查不到（${miss.slice(0, 4).join(', ')}${miss.length > 4 ? '…' : ''}）` : '')
    : '';
};
$('abulkGo').onclick = () => {
  const { got } = bulkParse($('abulk').value);
  const n = light(got, 0);
  save();
  $('abulkMsg').textContent = `点亮了 ${n} 个。`;
  $('abulk').value = '';
};

$('books').onclick = e => {
  const box = e.target.closest('.book');
  if (!box) return;
  const b = bookOf(box.dataset.id);
  if (e.target.classList.contains('use')) { S.book = b.id; save(); refreshSky(); renderBooks(); }
  if (e.target.classList.contains('upto')) {
    const n = Math.max(0, Math.min(b.words.length, +box.querySelector('input').value || 0));
    const k = light(b.words.slice(0, n), 0);
    save(); renderBooks();
    toast(k ? `点亮了 ${k} 颗星` : '前面的词都已经在星空里了');
  }
};
$('newN').oninput = () => { S.newN = +$('newN').value; $('newNv').textContent = S.newN; save(); };

$('tAdd').onclick = () => {
  const title = $('tTitle').value.trim() || `文章 ${TEXTS.length + 1}`;
  const body = $('tBody').value.trim();
  if (body.length < 20) { $('tMsg').textContent = '正文太短了。'; return; }
  TEXTS.push({ title, body, t: Date.now() });
  if (!saveTexts()) { TEXTS.pop(); $('tMsg').textContent = '存不下了：浏览器存储满了或被禁用。'; return; }
  indexTexts();
  $('tTitle').value = ''; $('tBody').value = ''; $('tMsg').textContent = '';
  openReader(TEXTS.length - 1);
};
$('tList').onclick = e => {
  if (e.target.classList.contains('tdel')) {
    const i = +e.target.dataset.i;
    if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = '确定删除？'; return; }
    TEXTS.splice(i, 1);
    saveTexts(); indexTexts(); renderTexts();
    return;
  }
  const li = e.target.closest('li[data-i]');
  if (li) openReader(+li.dataset.i);
};

$('rBody').onclick = e => {
  const el = e.target.closest('.w');
  if (el) showPop(el); else hidePop();
};
$('rClose').onclick = closeReader;
$('rAll').onclick = () => {
  const ws = ($('rAll').dataset.words || '').split(' ').filter(Boolean);
  const n = light(ws, 0);
  save(); repaint(ws);
  toast(`点亮了 ${n} 颗星`);
};
$('popSay').onclick = () => say(popW);
$('popLight').onclick = () => {
  const w = popW;
  if (!w) return;
  light([w], 0); save();
  Sky.setBright(w, bright(w), 1.4);
  repaint([w]);
  toast(`点亮了 ${w}`);
  hidePop();
};
$('popCard').onclick = () => { const w = popW; hidePop(); if (w) peek(w); };

$('sExp').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'xingci', ...S, texts: TEXTS }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `xingci-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('sImp').onclick = () => $('sFile').click();
$('sFile').onchange = async () => {
  const f = $('sFile').files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'xingci' || !Array.isArray(d.sky)) throw new Error('不是星词的备份文件');
    const texts = d.texts || [];
    delete d.app; delete d.texts;
    S = Object.assign(blank(), d);
    TEXTS = texts;
    save(); saveTexts();
    inSky.clear(); S.sky.forEach(x => inSky.add(x.w));
    indexTexts(); refreshSky();
    toast(`导入了 ${S.sky.length} 颗星`);
  } catch (e) { toast('导入失败：' + e.message); }
  $('sFile').value = '';
};
$('sAccent').onchange = () => { S.accent = $('sAccent').value; save(); say(cur ? cur.w : 'star'); };

$('sReset').onclick = () => {
  const b = $('sReset');
  if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '真的清空？再点一次'; return; }
  S = blank(); TEXTS = [];
  save(); saveTexts();
  inSky.clear(); indexTexts(); refreshSky();
  b.dataset.sure = ''; b.textContent = '清空星空和进度';
  closePanel(); renderEmpty();
};

addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') { e.target.blur(); closePanel(); }
    return;
  }
  const card = $('card');
  const on = card.classList.contains('on');
  const wrapped = card.classList.contains('wrap');
  // 读文章时空格是翻页，不抢
  if ($('reader').classList.contains('on') && !on && e.key !== 'Escape') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (openP) return;
    if (wrapped || !on) startRound();
    else if (cur && cur.isNew) lightCur(false);
    else if (!revealed) reveal();
  } else if (e.key === 'Escape') {
    if ($('pop').classList.contains('on')) hidePop();
    else if ($('card').classList.contains('on')) stop();
    else if ($('reader').classList.contains('on')) closeReader();
    else if (openP) closePanel(); else stop();
  } else if (e.key === 's' || e.key === 'S') {
    if (cur) say(cur.w);
  } else if ((e.key === 'k' || e.key === 'K') && cur && cur.isNew) {
    lightCur(true);
  } else if ((e.key === 't' || e.key === 'T') && !on && !openP) {
    toggleView();
  } else if ((e.key === 'a' || e.key === 'A') && !on) {
    e.preventDefault(); openPanel('add');
  } else if (on && !wrapped && revealed && cur && !cur.isNew && '123'.includes(e.key)) {
    grade({ '1': 2, '2': 1, '3': 0 }[e.key]);
  }
});

/* ---------------- 启动 ---------------- */

indexTexts();
Sky.start();
refreshSky();
setView(S.view === 'tree' ? 'tree' : 'sphere', true);
$('loading').remove();
if (!S.sky.length) renderEmpty();

/* 桌面版：浮窗里点一个词，主窗口直接打开它的卡片 */
if (window.xingciDesktop) {
  $('sWhere').textContent = '进度存在 save 文件夹里，拷走这个文件夹就是备份。';
  window.xingciDesktop.onOpenWord(w => {
    if (!IDX.has(w)) return;
    closePanel();
    stop();
    peek(w);
  });
  // 浮窗上点的「记得/忘了」，跟卡片上评分走同一套规则
  window.xingciDesktop.onGrade((w, g) => {
    if (!inSky.has(w)) return;
    touch(w, g);
    Sky.setBright(w, bright(w), 1.2);
    bumpToday();
    save();
    // 卡片正开着这个词：把上面的等级也刷新掉，别显示旧的
    if (cur && cur.w === w && !cur.isNew) {
      const p = S.prog[w];
      $('meta').innerHTML = `L${p.lv} · 见过 ${p.n} 次` + tagText(entry(w));
    }
  });
}
