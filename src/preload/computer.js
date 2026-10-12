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
  tab: (id) => ipcRenderer.invoke('computer-browser:tab', String(id || '')),
  closeTab: (id) => ipcRenderer.invoke('computer-browser:close-tab', String(id || '')),
  newTab: call('new-tab'),
  fullscreen: call('fullscreen'),
  stopAgent: call('stop-agent'),
  panel: call('panel'),
  send: (text) => ipcRenderer.invoke('computer-browser:send', String(text || '')),
  options: call('options'),
  micAccess: call('mic-access'),
  transcribe: call('transcribe'),
  onState: (fn) => { ipcRenderer.on('computer-browser:state', (_e, state) => fn(state)); },
  onFocusAddress: (fn) => { ipcRenderer.on('computer-browser:focus-address', () => fn()); },
});
