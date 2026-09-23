/* npm run selftest：在临时目录里起一次桌面版跑自检，打印每一项结果，有失败就返回非 0 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'xingci-selftest-'));
// 先放一份「有记录功能以前」的旧存档：昨天点亮、复习过，但没有 history.json
const yday = Date.now() - 864e5;
fs.mkdirSync(path.join(out, 'save'));
fs.writeFileSync(path.join(out, 'save', 'progress.json'), JSON.stringify({
  v: 1, sky: [{ w: 'zebra', t: yday }], prog: { zebra: { lv: 2, n: 3, bad: 1, last: yday + 6e5 } },
  book: 'ky3000', newN: 2, today: null, accent: 'us',
}));
const p = spawn(electron, [__dirname], { env: { ...process.env, XINGCI_SELFTEST: out }, stdio: 'inherit' });
const timer = setTimeout(() => p.kill(), 90e3);

p.on('exit', () => {
  clearTimeout(timer);
  let rep;
  try { rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')); }
  catch { console.error('没有生成报告，桌面版可能没起来：' + out); process.exit(1); }
  for (const [k, v] of Object.entries(rep.checks)) console.log((v === 'ok' ? '  ✓ ' : '  ✗ ') + k + (v === 'ok' ? '' : '  ' + v));
  if (rep.error) console.log('出错：' + rep.error);
  console.log(rep.pass ? '\n全部通过。' : '\n有没通过的。截图和报告在：' + out);
  process.exit(rep.pass ? 0 : 1);
});
