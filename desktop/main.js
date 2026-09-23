/* 星词桌面版
 *
 * 主窗口就是网页本体（../index.html），这里只多三样东西：
 * 托盘常驻、Alt+Shift+W 唤出、一个置顶的弹词浮窗。
 * 进度存在项目的 save/ 目录里（只读时改放用户目录），两个窗口都通过主进程读写同一份文件。
 */
'use strict';
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, powerMonitor, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'icon.ico');
const HOTKEY = 'Alt+Shift+W';
const FW = 440, FH = 210;
const AFK = 180;                   // 这么多秒没碰键盘鼠标就当人走开了

let win = null, float = null, tray = null;
const selftest = process.env.XINGCI_SELFTEST ? require('./selftest') : null;

/* ---------- 设置（浮窗位置、间隔、开关） ---------- */

const CFG = () => path.join(app.getPath('userData'), 'desktop.json');
let cfg = { interval: 60, floatOn: true, afkPause: true, autoSay: false, volume: 0.75, x: null, y: null };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG(), 'utf8')) }; } catch { /* 第一次启动 */ }
function saveCfg() {
  try { fs.writeFileSync(CFG(), JSON.stringify(cfg)); } catch { /* 写不了就算了，下次用默认值 */ }
}

/* ---------- 存档：写成 save/ 下的 JSON 文件，不放浏览器存储 ---------- */

// 从源码跑时数据放在项目里；装进只读目录（比如 Program Files）时改放用户目录
function dataDir() {
  if (process.env.XINGCI_SELFTEST) return process.env.XINGCI_SELFTEST;
  // 排查问题时拿一份存档副本跑，不碰真实进度：XINGCI_DATA=<目录>，里面放 save/
  if (process.env.XINGCI_DATA) {
    app.setPath('userData', path.join(process.env.XINGCI_DATA, 'profile'));
    return process.env.XINGCI_DATA;
  }
  // 打包后：便携版存在 exe 旁边，拷走文件夹就连进度一起带走；
  // 安装版存用户目录——安装目录在卸载时会被整个删掉，不能放那里
  const base = app.isPackaged ? process.env.PORTABLE_EXECUTABLE_DIR : ROOT;
  if (base) {
    try {
      const t = path.join(base, 'save', '.write-test');
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.writeFileSync(t, '');
      fs.unlinkSync(t);
      return base;
    } catch { /* 写不进去就退回用户目录 */ }
  }
  return app.getPath('userData');
}
const DATA = dataDir();
const SAVE = path.join(DATA, 'save');
const FILES = {
  'xingci.v1': 'progress.json',
  'xingci.texts.v1': 'texts.json',
  'xingci.float.hist': 'float-history.json',
};

ipcMain.on('store:get', (e, key) => {
  const f = FILES[key] && path.join(SAVE, FILES[key]);
  if (!f || !fs.existsSync(f)) { e.returnValue = null; return; }
  const raw = fs.readFileSync(f, 'utf8');
  try { JSON.parse(raw); e.returnValue = raw; }
  catch {
    // 🚨 读坏了就当没有存档的话，网页会用空进度覆盖掉它。先挪开留底
    fs.renameSync(f, f + '.broken-' + Date.now());
    e.returnValue = null;
  }
});

ipcMain.on('store:set', (e, key, val) => {
  const f = FILES[key] && path.join(SAVE, FILES[key]);
  if (!f) { e.returnValue = false; return; }
  try {
    fs.mkdirSync(SAVE, { recursive: true });
    // 先写临时文件再改名，写到一半断电也不会留下半截文件；上一版留成 .bak
    fs.writeFileSync(f + '.tmp', JSON.stringify(JSON.parse(val), null, 1));
    if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
    fs.renameSync(f + '.tmp', f);
    e.returnValue = true;
  } catch { e.returnValue = false; }
});

/* ---------- 发音缓存：每个词只下载一次，存在 cache/audio 下 ---------- */

const AUDIO = path.join(DATA, 'cache', 'audio');
const fetching = new Map();
ipcMain.handle('audio:get', async (_e, w, accent) => {
  if (!/^[a-z][a-z' .-]{0,40}$/i.test(w) || !['us', 'uk'].includes(accent)) return null;
  const f = path.join(AUDIO, accent, encodeURIComponent(w.toLowerCase()) + '.mp3');
  if (fs.existsSync(f)) return pathToFileURL(f).href;
  if (!fetching.has(f)) {
    fetching.set(f, (async () => {
      try {
        const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(w)}&type=${accent === 'uk' ? 1 : 2}`;
        const r = await net.fetch(url);
        if (!r.ok || !/audio/.test(r.headers.get('content-type') || '')) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f + '.tmp', buf);
        fs.renameSync(f + '.tmp', f);
        return pathToFileURL(f).href;
      } catch { return null; } finally { fetching.delete(f); }
    })());
  }
  return fetching.get(f);
});

/* 页面里的外部链接交给系统浏览器，窗口本身永远只显示本地页面 */
function lockDown(w) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
}

/* ---------- 主窗口 ---------- */

// 开机自启时也建好主窗口，只是不显示：浮窗上的「记得/忘了」要交给它来记
function makeWindow(show = true) {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 420, minHeight: 480,
    backgroundColor: '#0c0a09', autoHideMenuBar: true, show: false, icon: ICON,
    title: '星词',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(ROOT, 'index.html'));
  lockDown(win);
  win.once('ready-to-show', () => {
    // 自检时整个窗口不接收键盘：showInactive 之后 Windows 有时仍会把焦点给它，
    // 你在别处打字时的空格、T 就会被它吃掉，自检结果跟着乱
    if (selftest) win.setFocusable(false);
    if (show) selftest ? win.showInactive() : win.show();
  });
  win.on('close', e => {             // 关闭 = 收进托盘，浮窗照常弹
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function showMain() {
  if (!win) makeWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- 浮窗 ---------- */

function floatPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  // 记住的位置如果跑到屏幕外了（换过显示器），退回右下角
  const ok = cfg.x !== null && screen.getAllDisplays().some(d => {
    const b = d.workArea;
    return cfg.x >= b.x - FW / 2 && cfg.x < b.x + b.width - FW / 2 &&
           cfg.y >= b.y && cfg.y < b.y + b.height - 40;
  });
  return ok ? { x: cfg.x, y: cfg.y } : { x: wa.x + wa.width - FW - 16, y: wa.y + wa.height - FH - 8 };
}

function makeFloat() {
  const p = floatPos();
  float = new BrowserWindow({
    ...p, width: FW, height: FH,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    // 🚨 不能拿焦点：你正在敲代码时它弹出来，键盘输入不能被它吃掉
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'float-preload.js'), contextIsolation: true },
  });
  // screen-saver 是置顶里最高的一档，全屏的视频、浏览器、IDE 都盖得住（独占全屏的游戏除外）
  float.setAlwaysOnTop(true, 'screen-saver');
  float.setIgnoreMouseEvents(true, { forward: true });
  float.loadFile(path.join(__dirname, 'float.html'));
  lockDown(float);
  float.once('ready-to-show', () => { if (floatOn()) float.showInactive(); sendCfg(); });
}

// 托盘里的开关会记住；浮窗上的 × 只关到下次启动，免得点过一次就再也不出来
let snoozed = false;
let pausedUntil = 0, pauseT = null;
const floatOn = () => cfg.floatOn && !snoozed && Date.now() >= pausedUntil;

function pauseFor(min) {
  clearTimeout(pauseT);
  pausedUntil = min ? Date.now() + min * 60e3 : 0;
  if (min) pauseT = setTimeout(() => { pausedUntil = 0; applyFloat(); }, min * 60e3);
  applyFloat();
}

function sendCfg() {
  if (float) float.webContents.send('cfg', { interval: cfg.interval, on: floatOn(), autoSay: cfg.autoSay, volume: cfg.volume });
}

function applyFloat() {
  if (!float) return;
  if (floatOn()) float.showInactive(); else float.hide();
  sendCfg();
  buildMenu();
}

ipcMain.on('float:mouse', (_e, inside) => {
  // 鼠标在胶囊上才接收点击，其余透明部分让给下面的软件
  if (float) float.setIgnoreMouseEvents(!inside, { forward: true });
});
let dragFrom = null;
ipcMain.on('float:drag', (_e, d) => {
  if (!float) return;
  if (d.start) { const [x, y] = float.getPosition(); dragFrom = { x, y, sx: d.sx, sy: d.sy }; return; }
  if (!dragFrom) return;
  const x = Math.round(dragFrom.x + d.sx - dragFrom.sx), y = Math.round(dragFrom.y + d.sy - dragFrom.sy);
  float.setBounds({ x, y, width: FW, height: FH });
  if (d.end) { cfg.x = x; cfg.y = y; saveCfg(); dragFrom = null; }
});
ipcMain.on('float:open', (_e, w) => {
  showMain();
  win.webContents.send('open-word', w);
});
ipcMain.on('float:off', () => { snoozed = true; applyFloat(); });
// 进度只让主窗口写：它内存里有一份，浮窗直接写文件会被它下次保存盖掉
ipcMain.on('float:grade', (_e, w, g) => { if (win) win.webContents.send('grade', w, g); });
ipcMain.on('float:away', e => {
  e.returnValue = cfg.afkPause && (powerMonitor.getSystemIdleTime() >= AFK ||
                                   powerMonitor.getSystemIdleState(AFK) === 'locked');
});
ipcMain.on('float:interval', (_e, s) => { cfg.interval = s; saveCfg(); sendCfg(); buildMenu(); });
ipcMain.on('float:autosay', (_e, v) => { cfg.autoSay = !!v; saveCfg(); sendCfg(); buildMenu(); });
ipcMain.on('float:volume', (_e, v) => { cfg.volume = Math.max(0, Math.min(1, +v || 0)); saveCfg(); sendCfg(); buildMenu(); });

/* ---------- 托盘 ---------- */

function buildMenu() {
  const iv = (s, label) => ({
    label, type: 'radio', checked: cfg.interval === s,
    click: () => { cfg.interval = s; saveCfg(); sendCfg(); },
  });
  const vol = v => ({
    label: v * 100 + '%', type: 'radio', checked: cfg.volume === v,
    click: () => { cfg.volume = v; saveCfg(); sendCfg(); },
  });
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开星词', click: showMain },
    { type: 'separator' },
    { label: '浮窗弹词', type: 'checkbox', checked: floatOn(), click: m => {
      cfg.floatOn = m.checked; snoozed = false; saveCfg(); pauseFor(0);
    } },
    pausedUntil > Date.now()
      ? { label: `继续弹词（原定暂停到 ${new Date(pausedUntil).toTimeString().slice(0, 5)}）`, click: () => pauseFor(0) }
      : { label: '暂停一会儿', enabled: cfg.floatOn && !snoozed, submenu: [
          { label: '30 分钟', click: () => pauseFor(30) },
          { label: '1 小时', click: () => pauseFor(60) },
          { label: '2 小时', click: () => pauseFor(120) },
        ] },
    { label: '弹词间隔', submenu: [iv(15, '15 秒'), iv(30, '30 秒'), iv(60, '1 分钟'), iv(180, '3 分钟')] },
    { label: '浮窗回到右下角', click: () => {
      cfg.x = cfg.y = null; saveCfg();
      if (float) float.setBounds({ ...floatPos(), width: FW, height: FH });
    } },
    { label: '弹词时自动读一遍', type: 'checkbox', checked: cfg.autoSay,
      click: m => { cfg.autoSay = m.checked; saveCfg(); sendCfg(); } },
    { label: '浮窗音量', submenu: [vol(0.25), vol(0.5), vol(0.75), vol(1)] },
    { label: '离开电脑时不换词', type: 'checkbox', checked: cfg.afkPause,
      click: m => { cfg.afkPause = m.checked; saveCfg(); } },
    { type: 'separator' },
    { label: '开机自动启动', type: 'checkbox', checked: login,
      click: m => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

/* ---------- 启动 ---------- */

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', showMain);

app.setAppUserModelId('xingci.desktop');

app.whenReady().then(() => {
  // 开机自启时只挂托盘和浮窗，不弹主窗口
  makeWindow(!process.argv.includes('--hidden'));
  makeFloat();

  const img = nativeImage.createFromPath(ICON);
  if (img.isEmpty()) console.error('托盘图标没读到：', ICON);   // 空图标 = 托盘里透明一格，像没启动
  tray = new Tray(img);
  tray.setToolTip('星词');
  tray.on('click', showMain);
  buildMenu();

  if (!globalShortcut.register(HOTKEY, showMain)) console.error('热键被占用：', HOTKEY);
  if (selftest) selftest();
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
