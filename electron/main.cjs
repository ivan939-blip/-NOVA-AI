const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const NOVA_URL = process.env.NOVA_URL || 'https://nova-ai-7qd.pages.dev/';
const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const APP_CATALOG = {
  chrome: { label: 'Google Chrome', candidates: [path.join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe')] },
  edge: { label: 'Microsoft Edge', candidates: [path.join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')] },
  explorer: { label: 'Провідник', candidates: ['explorer.exe'] },
  notepad: { label: 'Блокнот', candidates: ['notepad.exe'] },
  calculator: { label: 'Калькулятор', candidates: ['calc.exe'] }
};

function availableApps() {
  return Object.entries(APP_CATALOG).filter(([, value]) => value.candidates.some(candidate => candidate.endsWith('.exe') && !candidate.includes('\\') || fs.existsSync(candidate))).map(([id, value]) => ({ id, label: value.label }));
}

ipcMain.handle('nova:apps:list', () => availableApps());
ipcMain.handle('nova:apps:open', (_event, id) => {
  const appInfo = APP_CATALOG[id];
  if (!appInfo) return { ok: false, error: 'Ця програма не входить до дозволеного каталогу NOVA.' };
  const executable = appInfo.candidates.find(candidate => candidate.endsWith('.exe') && !candidate.includes('\\') || fs.existsSync(candidate));
  if (!executable) return { ok: false, error: `${appInfo.label} не знайдено на цьому комп’ютері.` };
  try { const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); return { ok: true, label: appInfo.label }; }
  catch { return { ok: false, error: `Не вдалося відкрити ${appInfo.label}.` }; }
});

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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
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
