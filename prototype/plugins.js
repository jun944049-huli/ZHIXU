/* Plugin credentials are kept by the desktop service, never in snapshots. */
const pluginState = { items: [], loaded: false, loading: false, error: '', busy: false, id: null };

function pluginListHTML() {
  if (!window.xiaoyuDesktop?.plugins) return `<div class="plugin-empty">
    ${icon('zap', 24)}<h3>安装你的工具</h3><p class="muted">在知序桌面版中安装和运行 MCP 插件。</p>
    <button class="btn" data-action="plugin-add">${icon('plus', 14)} 添加插件</button></div>`;
  if (pluginState.error) return `<div class="plugin-empty"><p role="alert">${esc(pluginState.error)}</p>
    <button class="btn" data-action="plugin-refresh">${icon('refresh', 14)} 重试</button></div>`;
  if (!pluginState.loaded) return '<p class="muted" role="status">正在读取插件…</p>';
  if (!pluginState.items.length) return `<div class="plugin-empty">${icon('zap', 24)}<h3>还没有安装插件</h3>
    <p class="muted">添加 MCP 工具，连接你需要的服务。</p>
    <button class="btn" data-action="plugin-add">${icon('plus', 14)} 添加插件</button></div>`;
  return `<div class="connector-grid">${pluginState.items.map(p => `<button class="connector-card plugin-card" data-action="plugin-manage" data-id="${esc(p.id)}">
    <div class="connector-top"><span class="plugin-symbol">${icon('zap', 20)}</span><div class="plugin-card-title">
      <div class="connector-name">${esc(p.name)}</div><div class="connector-meta">v${esc(p.version)}</div></div>
      <span class="connector-status ${p.status === 'connected' ? 'on' : 'off'}"></span></div>
    <div class="connector-foot"><span>${p.status === 'connected' ? `${p.tools.length} 个工具可用` : p.status === 'error' ? '连接失败' : '已安装 · 未连接'}</span><span class="link">管理</span></div>
    </button>`).join('')}</div>`;
}

function renderPlugins() {
  return `<div class="section-title-row"><h2>插件</h2><div class="actions">
    <button class="icon-btn" data-action="plugin-refresh" aria-label="刷新插件" title="刷新插件">${icon('refresh', 16)}</button>
    <button class="btn btn-primary btn-sm" data-action="plugin-add">${icon('plus', 14)} 添加插件</button>
  </div></div><div id="plugin-list">${pluginListHTML()}</div>`;
}

async function refreshPlugins() {
  if (!window.xiaoyuDesktop?.plugins || pluginState.loading) return;
  pluginState.loading = true;
  try {
    const result = await window.xiaoyuDesktop.plugins({ action: 'list' });
    pluginState.items = result.plugins;
    pluginState.error = '';
    pluginState.loaded = true;
  } catch (error) { pluginState.error = pluginError(error); }
  finally {
    pluginState.loading = false;
    const list = document.getElementById('plugin-list');
    if (list) list.innerHTML = pluginListHTML();
  }
}

function mountPlugins() {
  if (state.view === 'data' && state.dataTab === 'plugins') void refreshPlugins();
}

function pluginError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function openPluginInstaller() {
  const desktop = !!window.xiaoyuDesktop?.plugins;
  localModal('添加插件', `<p class="muted">输入 npm 包名、GitHub 仓库地址或本地目录。</p>
    <div class="plugin-source-row"><input id="plugin-source" class="input" aria-label="插件来源" placeholder="例如 @modelcontextprotocol/server-filesystem" maxlength="2000" autocomplete="off">
      <button class="icon-btn" data-action="plugin-pick" aria-label="选择本地插件目录" title="选择本地目录" ${desktop ? '' : 'disabled'}>${icon('folder', 20)}</button></div>
    <div class="plugin-install-options"><details><summary>安装指南与示例</summary><div class="plugin-guide">
      <p>包名：<code>@modelcontextprotocol/server-filesystem</code><br>GitHub：<code>https://github.com/作者/仓库</code><br>本地：选择含 package.json 的项目目录。</p>
      <p>支持带单一 JavaScript 入口的 MCP 服务。仓库须包含已构建入口；安装脚本不会执行。DeepSeek 等应用的专用插件需要适配。</p>
      <p>安装后在「管理」中填写启动参数和环境变量，再连接并使用工具。</p></div></details>
      <label class="plugin-registry">安装源 <select id="plugin-registry" class="select" aria-label="安装源"><option value="official">npm 官方源</option><option value="china">中国大陆镜像源</option></select></label></div>
    <p class="plugin-trust">插件连接后会以你的本机权限运行，请仅安装可信来源。</p>
    <div id="plugin-result" class="plugin-feedback" role="status">${desktop ? '' : '请打开知序桌面版安装插件。浏览器预览无法运行本地插件。'}</div>`,
    `<button class="btn btn-primary plugin-install-button" data-action="plugin-install" disabled>${icon('download', 14)} 安装</button>`, 'plugin-modal');
  document.getElementById('plugin-source')?.focus();
}

function pluginFeedback(message, failed = false) {
  const result = document.getElementById('plugin-result');
  if (result) { result.textContent = message; result.classList.toggle('failed', failed); }
}

function pluginBusy(busy) {
  pluginState.busy = busy;
  document.querySelectorAll('.plugin-modal [data-action]:not([data-action="close-modal"])').forEach(button => { button.disabled = busy; });
  document.querySelectorAll('.plugin-modal input,.plugin-modal select,.plugin-modal textarea').forEach(input => { input.disabled = busy; });
  updatePluginInstallButton();
}

function updatePluginInstallButton() {
  const button = document.querySelector('[data-action="plugin-install"]');
  if (button) button.disabled = pluginState.busy || !window.xiaoyuDesktop?.plugins || !document.getElementById('plugin-source')?.value.trim();
}

function openPluginManager(id) {
  const p = pluginState.items.find(item => item.id === id);
  if (!p) { showToast('未找到插件，请刷新'); return; }
  pluginState.id = id;
  const connected = p.status === 'connected';
  localModal(p.name, `<div class="plugin-metadata"><span>v${esc(p.version)}</span>
    <span class="chip ${connected ? 'green' : ''}">${connected ? '已连接' : p.status === 'error' ? '连接失败' : '未连接'}</span></div>
    <p class="small muted plugin-source-label">${esc(p.source)}</p>
    <div class="field"><label for="plugin-args">启动参数（JSON 数组）</label><textarea class="input plugin-json" id="plugin-args" spellcheck="false">${esc(JSON.stringify(p.args, null, 2))}</textarea></div>
    <div class="field"><label for="plugin-env">环境变量（JSON 对象）</label><textarea class="input plugin-json" id="plugin-env" spellcheck="false" autocomplete="off" placeholder="${esc(p.envKeys.length ? `已保存 ${p.envKeys.join(', ')}，留空保留；填写 {} 可清空` : '{"API_KEY":"你的密钥"}')}"></textarea>
      <p class="tiny muted">保存在本机安全存储中，留空保留。修改配置后需要重新连接。</p></div>
    ${connected ? `<div class="plugin-tools"><h3>工具 <span class="muted">${p.tools.length}</span></h3>
      ${p.tools.length ? `<div class="field"><label for="plugin-tool">选择工具</label><select class="select" id="plugin-tool">${p.tools.map(tool => `<option value="${esc(tool.name)}">${esc(tool.name)}</option>`).join('')}</select></div>
      <p id="plugin-tool-description" class="small muted"></p><details><summary>参数格式</summary><pre id="plugin-tool-schema"></pre></details>
      <div class="field"><label for="plugin-tool-arguments">调用参数（JSON 对象）</label><textarea id="plugin-tool-arguments" class="input plugin-json" spellcheck="false">{}</textarea></div>
      <button class="btn" data-action="plugin-call">${icon('play', 14)} 运行工具</button>
      <pre id="plugin-tool-output" role="status" class="plugin-tool-output" hidden></pre>` : '<p class="muted">插件未提供工具。</p>'}</div>` : ''}
    <div id="plugin-result" class="plugin-feedback ${p.error ? 'failed' : ''}" role="status">${esc(p.error)}</div>`,
    `<button class="btn btn-danger" data-action="plugin-remove-confirm">${icon('trash', 14)} 卸载</button>
    ${connected ? '<button class="btn" data-action="plugin-disable">停用</button>' : ''}
    <button class="btn" data-action="plugin-save">${icon('check', 14)} 保存配置</button>
    <button class="btn btn-primary" data-action="plugin-connect">${icon('link', 14)} ${connected ? '重新连接' : '连接插件'}</button>`, 'plugin-modal');
  updatePluginTool();
}

function updatePluginTool() {
  const p = pluginState.items.find(item => item.id === pluginState.id);
  const tool = p?.tools.find(item => item.name === document.getElementById('plugin-tool')?.value);
  if (!tool) return;
  document.getElementById('plugin-tool-description').textContent = tool.description || '';
  document.getElementById('plugin-tool-schema').textContent = JSON.stringify(tool.inputSchema, null, 2);
}

function pluginObject(id, fallback) {
  const text = document.getElementById(id)?.value.trim();
  if (!text) return fallback;
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写 JSON 对象，例如 {"API_KEY":"你的密钥"}');
  return value;
}

async function savePluginConfig(id) {
  let args;
  try { args = JSON.parse(document.getElementById('plugin-args').value); }
  catch { throw new Error('启动参数须为 JSON 数组，例如 ["D:/工作文件"]'); }
  if (!Array.isArray(args) || args.some(item => typeof item !== 'string')) throw new Error('启动参数须为字符串数组');
  const env = pluginObject('plugin-env', undefined);
  if (env && Object.values(env).some(item => typeof item !== 'string')) throw new Error('环境变量的值须为字符串');
  return window.xiaoyuDesktop.plugins({ action: 'configure', id, args, ...(env === undefined ? {} : { env }) });
}

async function handlePluginAction(action) {
  if (action === 'plugin-add') { openPluginInstaller(); return; }
  if (action === 'plugin-refresh') { await refreshPlugins(); return; }
  if (action === 'plugin-manage') return;
  if (!window.xiaoyuDesktop?.plugins) { pluginFeedback('请使用知序桌面版安装和运行插件。', true); return; }
  if (pluginState.busy) return;
  const id = pluginState.id;
  const modal = document.querySelector('.plugin-modal');
  const sourceInput = document.getElementById('plugin-source');
  if (action === 'plugin-remove-confirm') {
    localModal('卸载插件', '<p>将停止此插件并删除其安装文件和配置。原始插件目录不会删除。</p><div id="plugin-result" class="plugin-feedback" role="status"></div>',
      '<button class="btn" data-action="plugin-remove-cancel">取消</button><button class="btn btn-danger" data-action="plugin-remove">卸载插件</button>', 'plugin-modal');
    return;
  }
  if (action === 'plugin-remove-cancel') { openPluginManager(id); return; }
  pluginBusy(true);
  try {
    switch (action) {
      case 'plugin-pick': {
        const result = await window.xiaoyuDesktop.plugins({ action: 'pick' });
        if (result.path && sourceInput?.isConnected) sourceInput.value = result.path;
        break;
      }
      case 'plugin-install': {
        const source = sourceInput.value.trim();
        const registry = document.getElementById('plugin-registry').value;
        pluginFeedback('正在下载和检查插件，请稍候…');
        const result = await window.xiaoyuDesktop.plugins({ action: 'install', source, registry });
        await refreshPlugins();
        if (modal?.isConnected) { openPluginManager(result.id); pluginFeedback('安装完成。请配置需要的参数，再连接插件。'); }
        else showToast('插件安装完成，可在「插件」中管理');
        break;
      }
      case 'plugin-save':
      case 'plugin-connect': {
        pluginFeedback(action === 'plugin-connect' ? '正在保存配置并连接…' : '正在保存…');
        await savePluginConfig(id);
        if (action === 'plugin-connect') await window.xiaoyuDesktop.plugins({ action: 'connect', id });
        await refreshPlugins();
        if (modal?.isConnected) { openPluginManager(id); pluginFeedback(action === 'plugin-connect' ? '连接成功，可以使用下方工具。' : '配置已保存，请重新连接。'); }
        break;
      }
      case 'plugin-disable':
      case 'plugin-remove': {
        const result = await window.xiaoyuDesktop.plugins({ action: action === 'plugin-disable' ? 'disable' : 'remove', id });
        await refreshPlugins();
        if (modal?.isConnected) action === 'plugin-remove' ? closeModal() : openPluginManager(id);
        if (result.warning) showToast(result.warning);
        break;
      }
      case 'plugin-call': {
        const tool = document.getElementById('plugin-tool').value;
        const argumentsValue = pluginObject('plugin-tool-arguments', {});
        pluginFeedback('正在运行工具…');
        const result = await window.xiaoyuDesktop.plugins({ action: 'call', id, tool, arguments: argumentsValue });
        if (modal?.isConnected) {
          const output = document.getElementById('plugin-tool-output');
          output.hidden = false;
          output.textContent = result.text;
          pluginFeedback(result.isError ? '插件返回错误，请查看结果。' : result.truncated ? '运行完成，结果过长，仅显示部分内容。' : '运行完成。', !!result.isError);
        }
        break;
      }
    }
  } catch (error) {
    await refreshPlugins();
    if (modal?.isConnected) pluginFeedback(pluginError(error), true);
    else showToast(pluginError(error));
  } finally { pluginBusy(false); }
}

document.addEventListener('input', event => {
  if (event.target.id === 'plugin-source') updatePluginInstallButton();
});
document.addEventListener('change', event => {
  if (event.target.id === 'plugin-tool') updatePluginTool();
});
