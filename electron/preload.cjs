const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('NovaDesktop', {
  listApplications: () => ipcRenderer.invoke('nova:apps:list'),
  openApplication: (id) => ipcRenderer.invoke('nova:apps:open', id)
});
