'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatApi', {
  mouse: inside => ipcRenderer.send('float:mouse', inside),
  drag: d => ipcRenderer.send('float:drag', d),
  open: w => ipcRenderer.send('float:open', w),
  off: () => ipcRenderer.send('float:off'),
  grade: (w, g) => ipcRenderer.send('float:grade', w, g),
  away: () => ipcRenderer.sendSync('float:away'),
  audio: (w, accent) => ipcRenderer.invoke('audio:get', w, accent),
  interval: s => ipcRenderer.send('float:interval', s),
  autoSay: v => ipcRenderer.send('float:autosay', v),
  store: {
    get: key => ipcRenderer.sendSync('store:get', key),
    set: (key, val) => ipcRenderer.sendSync('store:set', key, val),
  },
  onCfg: cb => ipcRenderer.on('cfg', (_e, c) => cb(c)),
});
