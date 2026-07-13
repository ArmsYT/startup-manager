const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveApps: (apps) => ipcRenderer.invoke('save-apps', apps),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  pickExecutable: () => ipcRenderer.invoke('pick-executable'),
  pickIcon: () => ipcRenderer.invoke('pick-icon'),
  extractIcon: (execPath) => ipcRenderer.invoke('extract-icon', execPath),
  getFooterInfo: () => ipcRenderer.invoke('get-footer-info'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close')
});
