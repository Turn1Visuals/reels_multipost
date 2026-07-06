const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  getPlatforms: () => ipcRenderer.invoke('get-platforms'),
  postVideo: (payload) => ipcRenderer.invoke('post-video', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getYoutubePlaylists: () => ipcRenderer.invoke('get-youtube-playlists'),
  onPostProgress: (callback) => ipcRenderer.on('post-progress', (event, data) => callback(data))
})
