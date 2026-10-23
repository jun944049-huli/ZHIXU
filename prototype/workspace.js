/* The workspace stays separate from saved project and conversation data. */
const workspaceState = {
  open: false, tab: 'home', expanded: false, roots: [], rootId: '', path: '',
  entries: [], preview: null, error: '', folderRequest: 0,
  browser: { url: '', title: '', loading: false, canBack: false, canForward: false, error: '' },
  address: '', command: '', output: '', running: false, cwd: '', history: [], historyIndex: 0
};
let workspaceResizeObserver, workspaceModalObserver, workspaceSubscribed = false, workspaceLayoutKey = '';

function workspaceIcon(name, size = 18) {
  const paths = {
    browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18"/>',
    terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'
  };
  return paths[name] ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>` : icon(name, size);
}

function workspaceButton(action, label, glyph, extra = '') {
  return `<button class="icon-btn sm" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${workspaceIcon(glyph, 17)}</button>`;
}

function renderWorkspace() {
  const ws = workspaceState;
  return `<aside class="workspace-panel ${ws.expanded ? 'expanded' : ''}" aria-label="工作区">
    <div class="workspace-head">
      <button class="workspace-heading" data-action="workspace-tab" data-tab="home">${icon('layers', 17)} 工作区</button>
      <div>${workspaceButton('workspace-expand', ws.expanded ? '还原工作区' : '展开工作区', 'expand')}
      ${workspaceButton('workspace-toggle', '关闭工作区', 'x')}</div>
    </div>
    <div class="workspace-tabs" role="tablist" aria-label="工作区工具">
      ${[['files', 'folder', '文件'], ['terminal', 'terminal', '终端'], ['browser', 'browser', '浏览器']].map(([tab, glyph, label]) =>
        `<button role="tab" aria-selected="${ws.tab === tab}" data-action="workspace-tab" data-tab="${tab}">${workspaceIcon(glyph, 15)}${label}</button>`).join('')}
    </div>
    <div id="workspace-content" class="workspace-content">${renderWorkspaceContent()}</div>
  </aside>`;
}

function renderWorkspaceContent() {
  const ws = workspaceState;
  const root = ws.roots.find(item => item.id === ws.rootId);
  const error = ws.error ? `<p class="workspace-error" role="alert">${esc(ws.error)}</p>` : '';
  if (ws.tab === 'home') return `<div class="workspace-start">
    ${[['files', 'folder', '工作区文件'], ['terminal', 'terminal', '新建终端'], ['browser', 'browser', '浏览器']].map(([tab, glyph, label]) =>
      `<button class="workspace-launch" data-action="workspace-tab" data-tab="${tab}">${workspaceIcon(glyph, 24)}<span>${label}</span>${icon('chevronRight', 17)}</button>`).join('')}
    </div>`;
  if (ws.tab === 'browser') return `<div class="workspace-browser-tools">
      ${workspaceButton('workspace-browser-back', '后退', 'chevronLeft', ws.browser.canBack ? '' : 'disabled')}
      ${workspaceButton('workspace-browser-forward', '前进', 'chevronRight', ws.browser.canForward ? '' : 'disabled')}
      ${workspaceButton('workspace-browser-reload', '刷新网页', 'refresh')}
      <input id="workspace-address" class="input" aria-label="网页地址" placeholder="输入网址" value="${esc(ws.address || ws.browser.url)}">
      ${workspaceButton('workspace-browser-go', '打开网页', 'arrowRight')}
    </div>${error}<p id="workspace-browser-error" class="workspace-error" role="alert" ${ws.browser.error ? '' : 'hidden'}>${esc(ws.browser.error)}</p>
    <div id="workspace-browser-mount" class="workspace-browser-mount">${ws.browser.url ? '' :
      `<div class="workspace-empty">${workspaceIcon('browser', 34)}<span>打开网页</span></div>`}</div>`;
  if (ws.tab === 'terminal') return `<div class="workspace-tool-head">
      <span class="workspace-path" title="${esc(ws.cwd || root?.path || '')}">${esc(ws.cwd || root?.name || '未选择文件夹')}</span>
      ${workspaceButton('workspace-folder-pick', '选择工作文件夹', 'folder')}
      ${workspaceButton('workspace-terminal-clear', '清空终端输出', 'trash')}
      ${workspaceButton('workspace-terminal-stop', '停止命令', 'x', ws.running ? '' : 'disabled')}
    </div>${error}
    <pre id="workspace-terminal-output" class="workspace-terminal-output" aria-label="终端输出" tabindex="0">${esc(ws.output)}</pre>
    <div class="workspace-terminal-input">
      <span aria-hidden="true">›</span><input id="workspace-command" aria-label="终端命令" autocomplete="off" spellcheck="false" placeholder="PowerShell 命令" value="${esc(ws.command)}" ${ws.running ? 'disabled' : ''}>
      ${workspaceButton('workspace-terminal-run', '运行命令', 'arrowRight', ws.running ? 'disabled' : '')}
    </div>`;
  const preview = ws.preview;
  return `<div class="workspace-tool-head">
      <span class="workspace-path">${preview ? esc(preview.name) : '文件'}</span>
      ${workspaceButton('workspace-folder-pick', '选择工作文件夹', 'folder')}
      ${workspaceButton('workspace-upload', '上传文件', 'plus')}
    </div>${error}<div class="workspace-files-scroll">
      ${preview ? `<div class="workspace-file-bar"><button class="btn btn-sm" data-action="workspace-preview-close">${icon('chevronLeft', 14)}返回</button>
        <button class="btn btn-sm" data-action="workspace-file-open">系统打开</button></div>
        ${preview.image ? `<img class="workspace-file-image" src="${esc(preview.image)}" alt="${esc(preview.name)}">` :
          preview.binary ? `<div class="workspace-empty">${icon('file', 32)}<span>此格式请使用系统应用打开</span></div>` :
          `<pre class="workspace-file-text">${esc(preview.text || '')}</pre>`}` :
      `<div class="workspace-section-label">本地文件夹</div>
      ${ws.roots.length ? `<select id="workspace-root" class="select" aria-label="工作文件夹">${ws.roots.map(item =>
        `<option value="${item.id}" ${ws.rootId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>
        <div class="workspace-breadcrumb">${workspaceButton('workspace-folder-up', '上级文件夹', 'chevronLeft', ws.path ? '' : 'disabled')}
          <span title="${esc(root?.path || '')}">${esc(ws.path || root?.name || '')}</span>
          ${workspaceButton('workspace-folder-refresh', '刷新文件夹', 'refresh')}</div>
        ${ws.entries.map(entry => `<button class="workspace-file-row" data-action="workspace-file-select" data-path="${esc(entry.path)}" data-directory="${entry.directory}">${icon(entry.directory ? 'folder' : 'file', 17)}<span>${esc(entry.name)}</span>${entry.directory ? icon('chevronRight', 14) : ''}</button>`).join('') ||
          '<p class="workspace-muted">文件夹为空</p>'}` :
        '<button class="workspace-folder-empty" data-action="workspace-folder-pick">选择文件夹</button>'}
      <div class="workspace-section-label">已上传文件</div>
      ${(DB.documents || []).map(doc => `<button class="workspace-file-row" data-action="document-open" data-id="${esc(doc.id)}">${icon('file', 17)}<span>${esc(doc.title)}</span></button>`).join('') ||
        '<p class="workspace-muted">暂无附件</p>'}`}
    </div>`;
}

async function workspaceRequest(payload) {
  if (!window.xiaoyuDesktop?.workspace) throw new Error('浏览器预览暂不提供本地工作区，请在知序桌面版中使用');
  return window.xiaoyuDesktop.workspace(payload);
}

function refreshWorkspace() {
  const content = document.getElementById('workspace-content');
  if (content) content.innerHTML = renderWorkspaceContent();
  document.querySelectorAll('.workspace-tabs [data-tab]').forEach(button =>
    button.setAttribute('aria-selected', String(button.dataset.tab === workspaceState.tab)));
  mountWorkspace();
}

async function loadWorkspaceFolder(path = '') {
  const ws = workspaceState, request = ++ws.folderRequest;
  const result = await workspaceRequest({ operation: 'folder-list', rootId: ws.rootId, path });
  if (request !== ws.folderRequest) return;
  ws.path = path; ws.entries = result.entries || []; ws.preview = null;
  ws.error = result.truncated ? '仅显示前 2000 项，请进入子文件夹继续浏览' : '';
  refreshWorkspace();
}

async function pickWorkspaceFolder() {
  const result = await workspaceRequest({ operation: 'folder-pick' });
  if (!result.root) return false;
  const ws = workspaceState;
  if (!ws.roots.some(root => root.id === result.root.id)) ws.roots.push(result.root);
  if (ws.rootId !== result.root.id) ws.cwd = result.root.path;
  ws.rootId = result.root.id;
  await loadWorkspaceFolder();
  return true;
}

async function runWorkspaceCommand() {
  const ws = workspaceState;
  if (ws.running || !ws.command.trim()) return;
  if (!ws.rootId && !await pickWorkspaceFolder()) return;
  const command = ws.command;
  ws.history.push(command); ws.historyIndex = ws.history.length;
  ws.output += `\n${ws.cwd || ws.roots.find(root => root.id === ws.rootId)?.path || ''}> ${command}\n`;
  ws.running = true; ws.command = ''; ws.error = '';
  refreshWorkspace();
  try { await workspaceRequest({ operation: 'terminal-run', rootId: ws.rootId, command }); }
  catch (error) { ws.running = false; throw error; }
}

async function handleWorkspaceAction(action, el) {
  const ws = workspaceState;
  try {
    ws.error = '';
    switch (action) {
      case 'workspace-toggle':
        ws.open = !ws.open;
        if (ws.open) state.chatDetails = false;
        render(); scrollChatToBottom(); return;
      case 'workspace-expand':
        ws.expanded = !ws.expanded; render(); scrollChatToBottom(); return;
      case 'workspace-tab':
        ws.tab = ['home', 'files', 'terminal', 'browser'].includes(el.dataset.tab) ? el.dataset.tab : 'home';
        refreshWorkspace(); return;
      case 'workspace-folder-pick': await pickWorkspaceFolder(); return;
      case 'workspace-folder-refresh': await loadWorkspaceFolder(ws.path); return;
      case 'workspace-folder-up':
        await loadWorkspaceFolder(ws.path.split(/[\\/]/).slice(0, -1).join('/')); return;
      case 'workspace-preview-close': ws.preview = null; refreshWorkspace(); return;
      case 'workspace-file-select':
        if (el.dataset.directory === 'true') { await loadWorkspaceFolder(el.dataset.path); return; }
        ws.preview = { name: el.textContent.trim(), path: el.dataset.path,
          ...await workspaceRequest({ operation: 'file-read', rootId: ws.rootId, path: el.dataset.path }) };
        refreshWorkspace(); return;
      case 'workspace-file-open':
        await workspaceRequest({ operation: 'file-open', rootId: ws.rootId, path: ws.preview?.path || '' }); return;
      case 'workspace-upload': openDocumentImport('chat'); return;
      case 'workspace-browser-go': {
        const url = document.getElementById('workspace-address')?.value.trim() || ws.address;
        if (!url) return;
        await workspaceRequest({ operation: 'browser-navigate', url });
        ws.address = url; ws.browser.url = url; ws.browser.error = '';
        refreshWorkspace(); return;
      }
      case 'workspace-browser-back':
      case 'workspace-browser-forward':
      case 'workspace-browser-reload':
        await workspaceRequest({ operation: action.replace('workspace-', '') }); return;
      case 'workspace-terminal-run': await runWorkspaceCommand(); return;
      case 'workspace-terminal-stop': await workspaceRequest({ operation: 'terminal-stop' }); return;
      case 'workspace-terminal-clear': ws.output = ''; refreshWorkspace(); return;
    }
  } catch (error) {
    ws.error = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    refreshWorkspace();
  }
}

function updateWorkspaceLayout() {
  if (!window.xiaoyuDesktop?.workspace) return;
  const mount = document.getElementById('workspace-browser-mount');
  const visible = state.view === 'chat' && workspaceState.open && workspaceState.tab === 'browser' &&
    !!workspaceState.browser.url && !!mount && !document.querySelector('#modal-root > *');
  const rect = visible ? mount.getBoundingClientRect() : null;
  const payload = { operation: 'browser-layout', visible,
    ...(rect ? { bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : {}) };
  const key = JSON.stringify(payload);
  if (key === workspaceLayoutKey) return;
  workspaceLayoutKey = key;
  workspaceRequest(payload).catch(error => { workspaceLayoutKey = ''; console.error(error); });
}

function mountWorkspace() {
  workspaceResizeObserver?.disconnect();
  const panel = document.querySelector('.workspace-panel');
  if (panel) {
    workspaceResizeObserver = new ResizeObserver(updateWorkspaceLayout);
    workspaceResizeObserver.observe(panel);
    const mount = document.getElementById('workspace-browser-mount');
    if (mount) workspaceResizeObserver.observe(mount);
    const output = document.getElementById('workspace-terminal-output');
    if (output) output.scrollTop = output.scrollHeight;
  }
  if (!workspaceModalObserver) {
    workspaceModalObserver = new MutationObserver(updateWorkspaceLayout);
    workspaceModalObserver.observe(document.getElementById('modal-root'), { childList: true });
    window.addEventListener('resize', updateWorkspaceLayout);
  }
  if (!workspaceSubscribed && window.xiaoyuDesktop?.onWorkspaceEvent) {
    workspaceSubscribed = true;
    window.xiaoyuDesktop.onWorkspaceEvent(event => {
      const ws = workspaceState;
      if (event.type === 'browser') {
        Object.assign(ws.browser, event);
        ws.address = event.url || ws.address;
        const address = document.getElementById('workspace-address');
        if (address && document.activeElement !== address) address.value = ws.address;
        const error = document.getElementById('workspace-browser-error');
        if (error) { error.textContent = event.error || ''; error.hidden = !event.error; }
        for (const [direction, available] of [['back', event.canBack], ['forward', event.canForward]]) {
          const button = document.querySelector(`[data-action="workspace-browser-${direction}"]`);
          if (button) button.disabled = !available;
        }
      } else {
        if (event.text) ws.output = (ws.output + event.text).slice(-1_000_000);
        if (event.cwd) ws.cwd = event.cwd;
        if (event.done) {
          ws.running = false;
          if (event.closed) ws.cwd = ws.roots.find(root => root.id === ws.rootId)?.path || '';
          if (event.exitCode) ws.output += `\n退出代码：${event.exitCode}\n`;
          if (ws.tab === 'terminal') refreshWorkspace();
        } else {
          const output = document.getElementById('workspace-terminal-output');
          if (output) {
            const bottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
            output.textContent = ws.output;
            if (bottom) output.scrollTop = output.scrollHeight;
          }
        }
      }
    });
  }
  requestAnimationFrame(updateWorkspaceLayout);
  Promise.all(document.getAnimations().filter(animation =>
    animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))).then(updateWorkspaceLayout);
}

document.addEventListener('input', event => {
  if (event.target.id === 'workspace-address') workspaceState.address = event.target.value;
  if (event.target.id === 'workspace-command') workspaceState.command = event.target.value;
});
document.addEventListener('change', event => {
  if (event.target.id !== 'workspace-root') return;
  workspaceState.rootId = event.target.value;
  workspaceState.cwd = '';
  loadWorkspaceFolder().catch(error => { workspaceState.error = error.message; refreshWorkspace(); });
});
document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.target.id === 'workspace-command') {
    if (event.key === 'Enter') {
      event.preventDefault(); handleWorkspaceAction('workspace-terminal-run', event.target);
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const ws = workspaceState;
      ws.historyIndex = Math.max(0, Math.min(ws.history.length, ws.historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      ws.command = ws.history[ws.historyIndex] || ''; event.target.value = ws.command;
    }
  }
  if (event.target.id === 'workspace-address' && event.key === 'Enter') {
    event.preventDefault(); handleWorkspaceAction('workspace-browser-go', event.target);
  }
});
