'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xingciDesktop', {
  onOpenWord: cb => ipcRenderer.on('open-word', (_e, w) => cb(w)),
  onGrade: cb => ipcRenderer.on('grade', (_e, w, g) => cb(w, g)),
  audio: (w, accent) => ipcRenderer.invoke('audio:get', w, accent),
  store: {
    get: key => ipcRenderer.sendSync('store:get', key),
    set: (key, val) => ipcRenderer.sendSync('store:set', key, val),
  },
});
