/* Loaded by the authenticated web host before the application starts. */
(() => {
  let revision = '';
  async function request(operation, payload, binary) {
    const response = await fetch('/remote-api/' + operation, {
      method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-Zhixu-Client': '1' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) window.dispatchEvent(new Event('zhixu-login-expired'));
      throw new Error(error.message || `请求失败（HTTP ${response.status}）`);
    }
    return binary ? response : response.json();
  }
  async function download(operation, payload) {
    const response = await request(operation, payload, true);
    const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') || '')?.[1];
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = name ? decodeURIComponent(name) : '知序导出';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { saved: true };
  }
  const unavailable = async () => { throw new Error('本机终端、文件夹和插件请在主机桌面版使用'); };
  window.xiaoyuDesktop = {
    isRemote: true,
    load: async () => {
      const result = await request('load');
      revision = result.revision;
      return result.snapshot;
    },
    save: async snapshot => {
      const result = await request('save', { snapshot, revision });
      revision = result.revision;
    },
    revision: async () => {
      const previous = revision;
      const result = await request('revision');
      return { changed: revision === previous && result.revision !== revision };
    },
    logout: () => request('logout', {}),
    polish: payload => request('polish', payload),
    captureTask: payload => request('capture-task', payload),
    chat: payload => request('chat', payload),
    summarizeChat: payload => request('chat-summary', payload),
    providerModels: payload => request('provider-models', payload),
    providerDiagnose: payload => request('provider-diagnose', payload),
    integration: payload => request('integration', payload),
    analyzeDocument: payload => request('document-analyze', payload),
    reparseDocument: payload => request('document-reparse', payload),
    importDocument: async payload => {
      const response = await fetch('/remote-api/document-import?name=' + encodeURIComponent(payload.name), {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Zhixu-Client': '1' },
        body: payload.bytes
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || '上传失败，请重试');
      return result;
    },
    exportFile: payload => download('export', payload),
    exportOriginal: payload => download('original', payload),
    backup: () => download('backup', {}),
    workspace: unavailable, plugins: unavailable, onWorkspaceEvent: () => () => {}
  };
})();
