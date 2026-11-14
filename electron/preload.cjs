'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(callback) {
  const listener = (_event, payload) => {
    try { callback(payload); } catch (err) { console.error(err); }
  };
  ipcRenderer.on('hf:event', listener);
  return () => ipcRenderer.removeListener('hf:event', listener);
}

contextBridge.exposeInMainWorld('hf', {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (patch) => ipcRenderer.invoke('config:save', patch),
    resetPrompt: () => ipcRenderer.invoke('config:resetPrompt'),
    test: (input) => ipcRenderer.invoke('config:test', input),
  },
  items: {
    list: () => ipcRenderer.invoke('items:list'),
    newId: () => ipcRenderer.invoke('items:newId'),
    save: (item) => ipcRenderer.invoke('items:save', item),
    remove: (id) => ipcRenderer.invoke('items:delete', id),
    discardDraft: (id) => ipcRenderer.invoke('items:discardDraft', id),
  },
  photos: {
    add: (itemId) => ipcRenderer.invoke('photos:add', { itemId }),
    addPaths: (itemId, paths) => ipcRenderer.invoke('photos:addPaths', { itemId, paths }),
    remove: (itemId, photoId) => ipcRenderer.invoke('photos:remove', { itemId, photoId }),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file); } catch { return ''; }
    },
  },
  ritual: {
    state: (day) => ipcRenderer.invoke('ritual:state', day),
    start: (day) => ipcRenderer.invoke('ritual:start', day),
    open: (day) => ipcRenderer.invoke('ritual:open', day),
    finish: (day, sessionId) => ipcRenderer.invoke('ritual:finish', { day, sessionId }),
    skip: (day) => ipcRenderer.invoke('ritual:skip', day),
    instigate: (day, sessionId, ordered, targetStatus) =>
      ipcRenderer.invoke('ritual:instigate', { day, sessionId, ordered, targetStatus }),
    stop: (sessionId) => ipcRenderer.invoke('ritual:stop', sessionId),
  },
  chat: {
    send: (sessionId, text) => ipcRenderer.invoke('chat:send', { sessionId, text }),
    generate: (sessionId) => ipcRenderer.invoke('chat:generate', sessionId),
    stop: (sessionId) => ipcRenderer.invoke('chat:stop', sessionId),
    freeState: () => ipcRenderer.invoke('chat:free:state'),
    freeSend: (text) => ipcRenderer.invoke('chat:free:send', { text }),
    freeGenerate: (forceNew) => ipcRenderer.invoke('chat:free:generate', forceNew),
    freeStop: () => ipcRenderer.invoke('chat:free:stop'),
    freeProactive: () => ipcRenderer.invoke('chat:free:proactive'),
  },
  calendar: {
    month: (year, month) => ipcRenderer.invoke('calendar:month', { year, month }),
    day: (day) => ipcRenderer.invoke('calendar:day', day),
  },
  memory: {
    overview: () => ipcRenderer.invoke('memory:overview'),
    session: (id) => ipcRenderer.invoke('memory:session', id),
  },
  data: {
    openDir: () => ipcRenderer.invoke('data:openDir'),
    backup: () => ipcRenderer.invoke('data:backup'),
    exportZip: () => ipcRenderer.invoke('data:export'),
    importZip: () => ipcRenderer.invoke('data:import'),
  },
  update: {
    check: (silent) => ipcRenderer.invoke('update:check', { silent }),
    apply: () => ipcRenderer.invoke('update:apply'),
    openRelease: () => ipcRenderer.invoke('update:openRelease'),
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onEvent: subscribe,
});

