/** Preload for the Code browser toolbar (local file only). Remote pages never get this bridge. */
const { contextBridge, ipcRenderer } = require('electron');

const call = (action) => (payload) => ipcRenderer.invoke(`computer-browser:${action}`, payload);
contextBridge.exposeInMainWorld('deizaBrowser', {
  state: call('state'),
  navigate: (url) => ipcRenderer.invoke('computer-browser:navigate', String(url || '')),
  back: call('back'),
  forward: call('forward'),
  reload: call('reload'),
  stop: call('stop'),
  onState: (fn) => { ipcRenderer.on('computer-browser:state', (_e, state) => fn(state)); },
});
