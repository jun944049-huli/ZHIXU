import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/contracts';

const api: DesktopAPI = {
  load: () => ipcRenderer.invoke('workbench:load'),
  save: snapshot => ipcRenderer.invoke('workbench:save', snapshot),
  polish: payload => ipcRenderer.invoke('workbench:polish', payload),
  chat: payload => ipcRenderer.invoke('workbench:chat', payload),
  providerModels: payload => ipcRenderer.invoke('workbench:provider-models', payload),
  providerDiagnose: payload => ipcRenderer.invoke('workbench:provider-diagnose', payload),
  integration: payload => ipcRenderer.invoke('workbench:integration', payload),
  exportFile: payload => ipcRenderer.invoke('workbench:export', payload),
  backup: () => ipcRenderer.invoke('workbench:backup'),
  importDocument: payload => ipcRenderer.invoke('workbench:document-import', payload),
  reparseDocument: payload => ipcRenderer.invoke('workbench:document-reparse', payload),
  analyzeDocument: payload => ipcRenderer.invoke('workbench:document-analyze', payload),
  exportOriginal: payload => ipcRenderer.invoke('workbench:document-original', payload)
};

contextBridge.exposeInMainWorld('xiaoyuDesktop', api);
