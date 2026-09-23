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
    const M = js => main.webContents.executeJavaScript(js);
    const F = js => float.webContents.executeJavaScript(js);

    const lit = await M(`$('empty').classList.remove('on');
      light(bookOf('ky3000').words.slice(0, 1450), 0); save(); S.sky.length`);
    const sees = await F(`(JSON.parse(XC.store.get('xingci.v1')) || {sky: []}).sky.length`);
    ok('浮窗读到主窗口的进度', lit === 1450 && sees === 1450, { lit, sees });
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
    ok('能翻回上一个', back[0] === w1 && back[1] === '1 / 2', back);

    // 回归：主窗口正开着这个词的卡片时，浮窗上点「记得」以前会被吞掉
    await M(`stop(); peek(${q})`);
    await F(`$('good').click()`);
    await wait(700);
    const lvMain = await M(`S.prog[${q}] && S.prog[${q}].lv`);
    const lvFile = await F(`JSON.parse(XC.store.get('xingci.v1')).prog[${q}].lv`);
    const meta = await M(`$('meta').textContent`);
    const btn = await F(`$('good').textContent`);
    ok('卡片开着时浮窗评分也能记上', lvMain === 1 && lvFile === 1, { lvMain, lvFile });
    ok('卡片上的等级跟着刷新', /^L1/.test(meta), meta);
    ok('浮窗按钮显示评分结果', /L0→L1/.test(btn), btn);
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
