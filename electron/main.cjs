const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const NOVA_URL = process.env.NOVA_URL || 'https://nova-ai-7qd.pages.dev/';

function createWindow() {
  const icon = app.isPackaged
    ? path.join(process.resourcesPath, 'nova-heroine.png')
    : path.join(__dirname, '..', 'public', 'nova-heroine.png');
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 640,
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#090510',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.loadURL(NOVA_URL);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://nova-ai-7qd.pages.dev/')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
