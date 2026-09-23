/* npm run dist：打出 Windows 的安装版和便携版，放在 desktop/release/。
 * 网页本体在上一层目录，electron-builder 只认一个目录，所以先把要用的文件拼到 .stage/ 里再打。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { build } = require('electron-builder');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(__dirname, '.stage');
const pkg = require('./package.json');

const FILES = [
  'index.html', 'style.css', 'app.js', 'core.js', 'sky.js', 'icon.ico', 'icon.svg', 'LICENSE',
  'data/dict.js', 'data/books.js',
  'desktop/main.js', 'desktop/preload.js', 'desktop/float-preload.js', 'desktop/float.html', 'desktop/float.js',
];

fs.rmSync(STAGE, { recursive: true, force: true });
for (const f of FILES) {
  const to = path.join(STAGE, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), to);
}
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: 'xingci', productName: pkg.productName, version: pkg.version,
  description: pkg.description, author: pkg.author, license: pkg.license,
  main: 'desktop/main.js',
}, null, 2));

build({
  config: {
    appId: 'xingci.desktop',                       // 跟 main.js 里的 setAppUserModelId 一致
    productName: pkg.productName,
    electronVersion: require('electron/package.json').version,
    directories: { app: STAGE, output: path.join(__dirname, 'release') },
    asar: true,
    win: {
      icon: path.join(ROOT, 'icon.ico'),
      target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      shortcutName: pkg.productName,
      artifactName: 'Xingci-${version}-setup.${ext}',
    },
    portable: { artifactName: 'Xingci-${version}-portable.${ext}' },
  },
}).then(out => {
  console.log('\n打好了：');
  for (const f of out) if (f.endsWith('.exe')) console.log('  ' + path.relative(__dirname, f));
}).catch(e => { console.error(e); process.exit(1); });
