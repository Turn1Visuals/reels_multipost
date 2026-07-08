const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  selectPostJson: () => ipcRenderer.invoke('select-post-json'),
  getPlatforms: () => ipcRenderer.invoke('get-platforms'),
  postVideo: (payload) => ipcRenderer.invoke('post-video', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  savePresets: (data) => ipcRenderer.invoke('save-presets', data),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getYoutubePlaylists: () => ipcRenderer.invoke('get-youtube-playlists'),
  platformConnect: (id) => ipcRenderer.invoke('platform-connect', id),
  platformDisconnect: (id) => ipcRenderer.invoke('platform-disconnect', id),
  platformConnection: (id) => ipcRenderer.invoke('platform-connection', id),
  onPostProgress: (callback) => ipcRenderer.on('post-progress', (event, data) => callback(data))
})
