import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { WorkbenchStore } from './database';
import { polish } from './polish';

let store: WorkbenchStore;
let window: BrowserWindow | null = null;

const dataOverride = process.env.XIAOYU_DATA_DIR;
const userDataPath = dataOverride || join(app.getPath('appData'), 'Xiaoyu');
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
app.setName('Xiaoyu');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    mkdirSync(dataDir, { recursive: true });
    store = new WorkbenchStore(join(dataDir, 'workbench.sqlite'), {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，设置未保存');
        return safeStorage.encryptString(value).toString('base64');
      },
      decrypt(value) {
        return safeStorage.decryptString(Buffer.from(value, 'base64'));
      }
    });
    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
      if (!window || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('不允许此窗口访问工作数据');
      }
    };
    ipcMain.handle('workbench:load', event => { checkSender(event); return store.load(); });
    ipcMain.handle('workbench:save', (event, payload: unknown) => {
      checkSender(event);
      store.save(payload);
    });
    ipcMain.handle('workbench:polish', (event, payload: unknown) => {
      checkSender(event);
      return polish(payload);
    });
    window = new BrowserWindow({
      width: 1440, height: 960, minWidth: 900, minHeight: 640,
      backgroundColor: '#ffffff',
      title: '小鱼 · 个人工作台',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) void window.loadURL(devUrl);
    else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    let closing = false;
    window.on('close', event => {
      if (closing || !window) return;
      event.preventDefault();
      closing = true;
      const currentWindow = window;
      void currentWindow.webContents.executeJavaScript(
        'typeof persistWorkbench === "function" ? persistWorkbench() : Promise.resolve()'
      ).then(() => currentWindow.destroy()).catch(error => {
        closing = false;
        dialog.showErrorBox('工作数据尚未保存', String(error));
      });
    });
    window.on('closed', () => { window = null; });
  }).catch(error => {
    dialog.showErrorBox('小鱼启动失败', String(error));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => store?.close());
