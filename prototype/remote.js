/* Remote access controls live in the host application, never in a shared page. */
let remoteStatusTimer;
function reloadWorkbench() {
  if (window.xiaoyuDesktop?.reload) void window.xiaoyuDesktop.reload();
  else location.reload();
}
function openRemoteAccess() {
  if (!window.xiaoyuDesktop?.remoteAccess) return;
  localModal('网页访问', `<div class="field">
      <label for="remote-password">访问密码</label><input class="input" type="password" id="remote-password"
      autocomplete="new-password" minlength="12" maxlength="200" placeholder="首次开启至少 12 个字符，之后留空沿用">
    </div>
    <div class="row gap-8 mt-12"><button class="btn btn-sm" data-action="remote-password-generate">${icon('refresh', 13)} 生成密码</button>
      <button class="btn btn-sm" data-action="remote-password-copy">${icon('copy', 13)} 复制密码</button></div>
    <div class="field mt-16"><label for="remote-url">HTTPS 地址</label><input class="input" id="remote-url" readonly placeholder="开启后显示">
      <button class="btn btn-sm mt-12" data-action="remote-url-copy">${icon('copy', 13)} 复制地址</button></div>
    <p class="small muted">主机需保持知序运行、联网且不休眠。重新开启后地址可能变化；关闭访问或修改密码会退出已登录设备。</p>
    <p id="remote-access-status" class="remote-feedback" role="status"></p>`,
    `<button class="btn" data-action="remote-stop">关闭访问</button>
    <button class="btn" data-action="remote-password">修改密码</button>
    <button class="btn btn-primary" data-action="remote-start">${icon('link', 13)} 开启网页访问</button>`, 'remote-modal');
  const update = async () => {
    if (!document.getElementById('remote-access-status')) { clearInterval(remoteStatusTimer); return; }
    try {
      const result = await window.xiaoyuDesktop.remoteAccess({ operation: 'status' });
      const label = document.getElementById('remote-access-status');
      if (!label) return;
      label.textContent = result.message;
      document.getElementById('remote-url').value = result.running ? result.url : '';
      document.querySelectorAll('.remote-modal [data-action="remote-start"],.remote-modal [data-action="remote-stop"],.remote-modal [data-action="remote-password"]')
        .forEach(button => { button.disabled = result.busy; });
    } catch (error) {
      const label = document.getElementById('remote-access-status');
      if (label) label.textContent = error.message;
    }
  };
  clearInterval(remoteStatusTimer);
  void update();
  remoteStatusTimer = setInterval(update, 2000);
}

async function remoteAction(action) {
  if (action === 'remote-settings') { openRemoteAccess(); return; }
  const password = document.getElementById('remote-password');
  if (action === 'remote-password-generate') {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    password.value = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    password.type = 'text'; return;
  }
  if (action.endsWith('-copy')) {
    const field = action === 'remote-url-copy' ? document.getElementById('remote-url') : password;
    if (!field?.value) { showToast('暂无可复制内容'); return; }
    try { await navigator.clipboard.writeText(field.value); showToast('已复制'); }
    catch { field.select(); showToast('请复制已选中的内容'); }
    return;
  }
  const status = document.getElementById('remote-access-status');
  try {
    if (action === 'remote-start') await persistWorkbench();
    document.querySelectorAll('.remote-modal .modal-foot button').forEach(button => { button.disabled = true; });
    if (status) status.textContent = '正在处理…';
    const result = await window.xiaoyuDesktop.remoteAccess({ operation: action.slice('remote-'.length), password: password?.value || undefined });
    if (password?.isConnected) { password.value = ''; password.type = 'password'; }
    if (status?.isConnected) status.textContent = result.message;
  } catch (error) {
    if (status?.isConnected) status.textContent = error.message;
  } finally {
    document.querySelectorAll('.remote-modal .modal-foot button').forEach(button => { button.disabled = false; });
  }
}

function workbenchSyncNotice(message) {
  let root = document.getElementById('workbench-sync-notice');
  if (!root) {
    root = document.createElement('div');
    root.id = 'workbench-sync-notice';
    root.setAttribute('role', 'status');
    document.body.append(root);
  }
  root.innerHTML = `<span>${esc(message)}</span><div>
    <button class="btn btn-sm" id="sync-export-draft">导出本次编辑</button>
    <button class="btn btn-sm" id="sync-reload">重新载入</button></div>`;
  root.querySelector('#sync-export-draft').onclick = () => {
    const snapshot = exportableSnapshot();
    const unsavedInputs = [...document.querySelectorAll('#modal-root input,#modal-root textarea,#modal-root select,#chat-input')]
      .filter(field => !['password', 'file'].includes(field.type))
      .map(field => ({ id: field.id, value: field.value }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ snapshot, unsavedInputs,
      exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = '知序-本次编辑.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  root.querySelector('#sync-reload').onclick = () => {
    if (confirm('未保存的本次编辑会被替换。请先导出需要保留的内容，再重新载入。')) reloadWorkbench();
  };
}

function initializeWorkbenchSync() {
  if (!window.xiaoyuDesktop?.revision) return;
  let checking = false;
  setInterval(async () => {
    if (checking || !workbenchReady || document.visibilityState === 'hidden' ||
        workbenchLastQueued !== workbenchLastSaved) return;
    checking = true;
    try {
      const result = await window.xiaoyuDesktop.revision();
      if (workbenchLastQueued !== workbenchLastSaved) return;
      if (!result.changed) { document.getElementById('workbench-sync-notice')?.remove(); return; }
      const editing = document.activeElement?.matches('input,textarea,[contenteditable="true"]') ||
        document.querySelector('#modal-root .modal') || state.chatSending || state.documentImportBusy ||
        state.documentReparsing || state.providerDiagnosing || DB.runningTimer;
      if (!editing && JSON.stringify(workbenchSnapshot()) === workbenchLastSaved) reloadWorkbench();
      else workbenchSyncNotice('其他设备已更新工作数据；请先保留本次编辑，再重新载入。');
    } catch { /* Offline clients keep their current content and report errors on save. */ }
    finally { checking = false; }
  }, 5000);
  window.addEventListener('zhixu-login-expired', () => {
    workbenchSyncNotice('登录已过期，请先保留本次内容，再重新登录。');
    const button = document.getElementById('sync-reload');
    if (button) button.textContent = '重新登录';
  });
}
