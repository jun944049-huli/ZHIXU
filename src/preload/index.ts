import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/contracts';

const api: DesktopAPI = {
  load: () => ipcRenderer.invoke('workbench:load'),
  save: snapshot => ipcRenderer.invoke('workbench:save', snapshot),
  polish: payload => ipcRenderer.invoke('workbench:polish', payload),
  integration: payload => ipcRenderer.invoke('workbench:integration', payload),
  exportFile: payload => ipcRenderer.invoke('workbench:export', payload),
  backup: () => ipcRenderer.invoke('workbench:backup')
};

contextBridge.exposeInMainWorld('xiaoyuDesktop', api);
