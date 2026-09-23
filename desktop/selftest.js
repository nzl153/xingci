/* 自检：XINGCI_SELFTEST=<输出目录> 时由 main.js 加载（平时用 npm run selftest 跑）。
 * 用一次性的 userData 和存档目录，不碰真实存档。跑完写 report.json 和截图，然后退出。 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = process.env.XINGCI_SELFTEST;
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', path.join(OUT, 'profile'));

const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function run() {
  const rep = { checks: {} };
  const ok = (name, cond, got) => { rep.checks[name] = cond ? 'ok' : 'FAIL: ' + JSON.stringify(got); };
  const snap = async (w, name) => {
    const img = await w.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  };
  try {
    await wait(2500);
    const [main, float] = ['星词', '星词浮窗'].map(t =>
      BrowserWindow.getAllWindows().find(w => w.getTitle() === t));
    ok('两个窗口都在', main && float, { main: !!main, float: !!float });
    ok('浮窗不抢焦点', !float.isFocusable(), float.isFocusable());
    ok('浮窗置顶', float.isAlwaysOnTop(), float.isAlwaysOnTop());
    // 页面里抛的错只会说「Script failed」，真正的报错在控制台里，一起收进报告
    const errs = rep.console = [];
    for (const [name, w] of [['主窗口', main], ['浮窗', float]]) {
      w.webContents.on('console-message', e => {
        if (e.level === 'error' || e.level === 3) errs.push(`${name}：${e.message}`);
      });
    }
    // try 块的值就是最后一个表达式的值，所以包一层不影响返回值，出错时能拿到真正的报错
    const run = async (w, js) => {
      const r = await w.webContents.executeJavaScript(`try {\n${js}\n} catch (e) { ({ __err: String(e && e.stack || e) }) }`)
        .catch(e => ({ __err: String(e) + '\n' + errs.slice(-3).join('\n') }));
      if (r && r.__err) throw new Error(`执行失败：${js.trim().slice(0, 80)}\n${r.__err}`);
      return r;
    };
    const M = js => run(main, js);
    const F = js => run(float, js);

    const old = fs.existsSync(path.join(OUT, 'save', 'history.json')) &&
      JSON.parse(fs.readFileSync(path.join(OUT, 'save', 'history.json'), 'utf8')).ev.map(e => e[1] + ':' + e[2] + ':' + e[4]);
    const oldTl = await M(`peek('zebra'); reveal(); const t = $('tl').textContent; stop(); t`);
    ok('旧存档第一次打开会补出记录', String(old) === 'zebra:L:o,zebra:P:o' && /点亮.*之前复习过 · L2/.test(oldTl), { old, oldTl });

    const lit = await M(`$('empty').classList.remove('on');
      light(bookOf('ky3000').words.slice(0, 1450), 0); save(); S.sky.length`);
    const sees = await F(`(JSON.parse(XC.store.get('xingci.v1')) || {sky: []}).sky.length`);
    ok('浮窗读到主窗口的进度', lit === 1451 && sees === 1451, { lit, sees });
    ok('进度写成了文件', fs.existsSync(path.join(OUT, 'save', 'progress.json')));
    const mig = await M(`localStorage.setItem(TKEY, '[{"title":"t","body":"old"}]'); store.get(TKEY)`);
    ok('旧的浏览器存储会搬进文件', mig && fs.existsSync(path.join(OUT, 'save', 'texts.json')), mig);

    const w1 = await F(`fresh(); hist[pos]`);
    const q = JSON.stringify(w1);
    await wait(4600);
    const cn = await F(`$('cap').classList.contains('meaning') && $('cn').textContent`);
    ok('4 秒后出释义', !!cn, cn);
    ok('释义截短了', cn && cn.length <= 30, cn);
    await snap(float, 'float');

    await F(`$('next').click()`);
    const back = await F(`$('prev').click(); [hist[pos], $('pos').textContent]`);
    ok('能翻回上一个', back[0] === w1 && /^\d+ \/ \d+$/.test(back[1]), back);

    // 回归：主窗口正开着这个词的卡片时，浮窗上点「记得」以前会被吞掉
    await M(`stop(); peek(${q})`);
    await F(`$('good').click()`);
    await wait(700);
    const lvMain = await M(`S.prog[${q}] && S.prog[${q}].lv`);
    const lvFile = await F(`JSON.parse(XC.store.get('xingci.v1')).prog[${q}].lv`);
    const meta = await M(`$('meta').textContent`);
    const btn = await F(`[...graded.values()].pop().msg`);
    ok('卡片开着时浮窗评分也能记上', lvMain === 1 && lvFile === 1, { lvMain, lvFile });
    ok('卡片上的等级跟着刷新', /^L1/.test(meta), meta);
    ok('浮窗按钮显示评分结果', /L0→L1/.test(btn), btn);
    await wait(500);
    const moved = await F(`hist[pos]`);
    ok('浮窗点记得后换下一个词', moved !== w1, { w1, moved });

    const w2 = await F(`hist[pos]`);
    await F(`$('bad').click()`);
    await wait(1200);
    const stay = await F(`[hist[pos], $('cap').classList.contains('meaning')]`);
    ok('浮窗点忘了停在原词看释义', stay[0] === w2 && stay[1], { w2, stay });

    // 记录：主窗口和浮窗的评分、浮窗弹过的次数都写进了 history.json
    const H = () => JSON.parse(fs.readFileSync(path.join(OUT, 'save', 'history.json'), 'utf8'));
    const h1 = H();
    const fEv = h1.ev.filter(e => e[4] === 'f').map(e => e[1] + ':' + e[2]);
    const shows = Object.values(h1.shows).reduce((a, b) => a + b, 0);
    ok('记录写进了文件', h1.ev.filter(e => e[2] === 'L').length >= 1450 &&
       fEv.join() === `${w1}:2,${w2}:0` && shows >= 2, { L: h1.ev.length, fEv, shows });
    await M(`stop()`);

    // 主窗口卡片上评分要有提示
    await M(`peek(${q}); reveal(); grade(2)`);
    const toast = await M(`$('toast') && $('toast').textContent`);
    ok('卡片评分有提示', /L1 → L2/.test(String(toast)), toast);

    // 一轮里评分：响一声、卡片亮一圈、上方飘等级变化
    const fxr = await M(`stop(); peek(${q}); $('card').classList.remove('solo'); reveal(); grade(0);
      [document.querySelector('.fxchip') && document.querySelector('.fxchip').textContent,
       $('card').classList.contains('fx-bad'), XC.sfx('good', 0.3), XC.sfx('good', 0)]`);
    ok('卡片评分有音效和动效', fxr.join() === '归零,true,true,false', fxr);
    await M(`stop()`);

    const tl = await M(`peek(${q}); reveal(); $('tl').textContent`);
    ok('卡片上有这个词的时间线', /点亮.*记得.*记得.*忘了/.test(tl), tl);
    await M(`stop()`);

    // 记录面板：今天那一行、复查这一天、导出
    const day = await M(`openPanel('log'); lTab = 'day'; renderLog();
      [document.querySelectorAll('#lBody .day').length, $('lBody').querySelector('.day.open .dh span').textContent,
       !!$('lBody').querySelector('[data-rev]')]`);
    ok('记录面板按天列出', day[0] >= 1 && /评分/.test(day[1]) && day[2], day);
    const rv = await M(`$('lBody').querySelector('[data-rev$="|rated"]').nextElementSibling.click();
      [cur && cur.w, sess.label, sess.max, $('round').textContent]`);
    ok('复查这一天', rv[0] === w1 && /^复查/.test(rv[1]) && rv[2] >= 1450, rv);
    const rr = await M(`stop(); openPanel('log'); lTab = 'day'; renderLog();
      $('lBody').querySelector('[data-rev$="|rated"]').click(); [sess.max, cur && cur.w]`);
    ok('只复查评过的', rr[0] >= 2 && rr[0] < 10 && rr[1] === w1, rr);
    await M(`stop()`);
    for (const t of ['bad', 'week']) {
      const n = await M(`openPanel('log'); lTab = '${t}'; renderLog(); $('lBody').querySelectorAll('.wc').length`);
      ok(`记录面板：${t}`, n >= 1, n);
    }
    const md = await M(`exportMd(today())`);
    const mdText = md && fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '';
    ok('导出 Markdown', mdText.includes('## 忘了') && mdText.includes(w1), md);
    await M(`closePanel()`);

    await M(`stop(); toggleView()`);
    await wait(1800);
    const tv = await M(`[Sky.viewName(), S.view, JSON.parse(store.get(KEY)).view]`);
    const mid = await M(`[S.view, Sky.viewName(), document.hasFocus()]`);
    await M(`toggleView()`);
    await wait(1800);
    const sv = await M(`[Sky.viewName(), S.view, document.hasFocus()]`);
    ok('星球和词树能来回切换并记住', tv.join() === 'tree,tree,tree' && sv[0] === 'sphere', { tv, mid, sv });

    const url = await F(`window.floatApi.audio('scheme', 'us')`);
    ok('在线发音下载并缓存', url && fs.existsSync(new URL(url)), url);
    const t0 = Date.now();
    await F(`window.floatApi.audio('scheme', 'us')`);
    ok('第二次直接读缓存', Date.now() - t0 < 300, Date.now() - t0);
    const played = await F(`XC.say('scheme', 'us')`);
    ok('浮窗能读出来', played === true, played);

    const a0 = await F(`$('auto').classList.contains('is-on')`);
    await F(`$('auto').click()`);
    await wait(300);
    const a1 = await F(`[$('auto').classList.contains('is-on'), autoSay]`);
    await F(`$('auto').click()`);
    await wait(300);
    const a2 = await F(`$('auto').classList.contains('is-on')`);
    ok('自动朗读按钮能开能关', a0 === false && a1[0] && a1[1] && a2 === false, { a0, a1, a2 });

    const cyc = [];
    for (let i = 0; i < 4; i++) {
      await F(`$('iv').click()`);
      await wait(200);
      cyc.push(await F(`$('iv').textContent`));
    }
    ok('间隔按钮循环', cyc.join() === '3m,15s,30s,1m', cyc);

    const vols = [];
    for (let i = 0; i < 4; i++) {
      await F(`$('vol').click()`);
      await wait(200);
      vols.push(await F(`[volume, $('volN').textContent].join(':')`));
    }
    ok('浮窗音量按钮循环并记住', vols.join() === '1:100,0.25:25,0.5:50,0.75:75', vols);
    await F(`for (const id of ['ctl', 'grade']) { $(id).style.opacity = 1; $(id).style.transform = 'none'; }`);
    await wait(300);
    await snap(float, 'float-ctl');

    main.hide();
    await F(`api.open(hist[pos])`);
    await wait(1200);
    const cw = await M(`cur && cur.w`);
    const fw = await F(`hist[pos]`);
    ok('双击打开主窗口卡片', main.isVisible() && cw === fw, { visible: main.isVisible(), cw, fw });
    await snap(main, 'main');
  } catch (e) {
    rep.error = String(e && e.stack || e);
  }
  rep.pass = !rep.error && Object.values(rep.checks).every(v => v === 'ok');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rep, null, 1));
  app.isQuitting = true;
  app.quit();
};
