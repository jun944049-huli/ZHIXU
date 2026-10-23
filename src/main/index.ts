import { app, BrowserWindow, dialog, ipcMain, net, safeStorage } from 'electron';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WorkbenchStore } from './database';
import { polish } from './polish';
import { chat } from './chat';
import { providerDiagnose, providerModels } from './providers';
import { runIntegration } from './integrations';
import { exportBuffer, exportSchema, reportHTML } from './exports';
import { DocumentFiles } from './document-files';
import { analyzeDocument } from './document-analysis';
import { z } from 'zod';
import { Workspace } from './workspace';
import { Plugins } from './plugins';

let store: WorkbenchStore;
let window: BrowserWindow | null = null;

const dataOverride = process.env.XIAOYU_DATA_DIR;
const userDataPath = dataOverride || join(app.getPath('appData'), 'Xiaoyu');
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
app.setName('知序');
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
    ipcMain.handle('workbench:export', async (event, input: unknown) => {
      checkSender(event);
      const payload = exportSchema.parse(input);
      const filename = payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
      const result = await dialog.showSaveDialog(window!, {
        title: '导出文件', defaultPath: `${filename}.${payload.format}`,
        filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      if (payload.format === 'pdf') {
        const printWindow = new BrowserWindow({ show: false, webPreferences: {
          sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false
        } });
        try {
          await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHTML(payload.title, payload.text)));
          writeFileSync(result.filePath, await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
        } finally { printWindow.destroy(); }
      } else writeFileSync(result.filePath, await exportBuffer(payload));
      return { saved: true };
    });
    ipcMain.handle('workbench:backup', async event => {
      checkSender(event);
      const now = new Date();
      const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      const result = await dialog.showSaveDialog(window!, {
        title: '备份本地数据库', defaultPath: `知序备份-${localDate}.sqlite`,
        filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      if (resolve(dataDir, 'workbench.sqlite').toLowerCase() === resolve(result.filePath).toLowerCase()) {
        throw new Error('备份须另存为其他文件，请勿覆盖正在使用的数据库');
      }
      await store.backup(result.filePath);
      return { saved: true };
    });
    ipcMain.handle('workbench:polish', (event, payload: unknown) => {
      checkSender(event);
      return polish(payload);
    });
    ipcMain.handle('workbench:chat', (event, payload: unknown) => {
      checkSender(event);
      return chat(payload);
    });
    ipcMain.handle('workbench:provider-models', (event, payload: unknown) => {
      checkSender(event);
      return providerModels(payload);
    });
    ipcMain.handle('workbench:provider-diagnose', (event, payload: unknown) => {
      checkSender(event);
      return providerDiagnose(payload);
    });
    const documents = new DocumentFiles(join(dataDir, 'attachments'));
    let documentImportBusy = false;
    ipcMain.handle('workbench:document-import', async (event, payload: unknown) => {
      checkSender(event);
      if (documentImportBusy) throw new Error('正在处理另一份附件，请稍候');
      documentImportBusy = true;
      try { return await documents.import(payload); }
      finally { documentImportBusy = false; }
    });
    ipcMain.handle('workbench:document-analyze', (event, payload: unknown) => {
      checkSender(event);
      return analyzeDocument(payload);
    });
    ipcMain.handle('workbench:document-reparse', async (event, payload: unknown) => {
      checkSender(event);
      if (documentImportBusy) throw new Error('正在处理另一份附件，请稍候');
      documentImportBusy = true;
      try { return await documents.reparse(payload); }
      finally { documentImportBusy = false; }
    });
    ipcMain.handle('workbench:document-original', async (event, input: unknown) => {
      checkSender(event);
      const payload = z.object({ assetId: z.string().max(100), name: z.string().max(240) }).parse(input);
      const result = await dialog.showSaveDialog(window!, {
        title: '导出原文件', defaultPath: payload.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await documents.export(payload.assetId, result.filePath);
      return { saved: true };
    });
    const activeIntegrations = new Set<string>();
    ipcMain.handle('workbench:integration', async (event, payload: unknown) => {
      checkSender(event);
      const id = String((payload as { id?: unknown })?.id || '');
      if (activeIntegrations.has(id)) throw new Error('此连接器正在处理请求，请稍候');
      activeIntegrations.add(id);
      try { return await runIntegration(payload, { fetch: net.fetch.bind(net) }); }
      finally { activeIntegrations.delete(id); }
    });
    window = new BrowserWindow({
      width: 1440, height: 960, minWidth: 900, minHeight: 640,
      backgroundColor: '#ffffff',
      title: '知序',
      icon: join(import.meta.dirname, '../renderer/brand/zhixu.png'),
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
    const workspace = new Workspace(window);
    const plugins = new Plugins(join(dataDir, 'plugins'), window, {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，插件配置未保存');
        return safeStorage.encryptString(value).toString('base64');
      },
      decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64'))
    });
    ipcMain.handle('workbench:plugins', (event, payload: unknown) => {
      checkSender(event);
      return plugins.handle(payload);
    });
    ipcMain.handle('workbench:workspace', (event, payload: unknown) => {
      checkSender(event);
      return workspace.handle(payload);
    });
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
      ).then(async () => { await plugins.dispose(); workspace.dispose(); currentWindow.destroy(); }).catch(error => {
        closing = false;
        dialog.showErrorBox('工作数据尚未保存', String(error));
      });
    });
    window.on('closed', () => { void plugins.dispose(); workspace.dispose(); window = null; });
  }).catch(error => {
    dialog.showErrorBox('知序启动失败', String(error));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => store?.close());
