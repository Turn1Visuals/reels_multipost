const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  getPlatforms: () => ipcRenderer.invoke('get-platforms'),
  postVideo: (payload) => ipcRenderer.invoke('post-video', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onPostProgress: (callback) => ipcRenderer.on('post-progress', (event, data) => callback(data))
})
