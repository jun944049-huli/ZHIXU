/* Update controls are available only in the installed host application. */
let desktopUpdateStatus;
function paintDesktopUpdate(status) {
  desktopUpdateStatus = status;
  let notice = document.getElementById('desktop-update-notice');
  if (status.stage === 'ready') {
    if (!notice) {
      notice = document.createElement('button');
      notice.id = 'desktop-update-notice';
      notice.className = 'btn btn-sm';
      notice.dataset.action = 'update-settings';
      document.body.append(notice);
    }
    notice.textContent = `新版本 ${status.version} 已就绪`;
  } else notice?.remove();
  const output = document.getElementById('update-status');
  if (!output) return;
  output.textContent = status.message;
  document.getElementById('update-current-version').textContent = `当前版本 ${status.currentVersion}`;
  document.getElementById('update-target-version').textContent = status.version ? `新版本 ${status.version}` : '';
  document.getElementById('update-checked-at').textContent = status.checkedAt ?
    `上次检查 ${new Date(status.checkedAt).toLocaleString()}` : '尚未检查';
  document.getElementById('update-access').textContent = status.access === 'git' ? '已使用本机 GitHub 登录' :
    status.hasToken ? '已保存 GitHub 令牌' : '使用公开仓库，无需登录';
  const progress = document.getElementById('update-progress');
  progress.hidden = status.stage !== 'downloading';
  progress.value = status.percent;
  progress.setAttribute('aria-label', `下载进度 ${Math.round(status.percent)}%`);
  const busy = ['checking', 'downloading', 'installing'].includes(status.stage);
  document.querySelectorAll('.update-modal [data-action="update-check"],.update-modal [data-action="update-save"],.update-modal [data-action="update-clear"]')
    .forEach(button => { button.disabled = busy; });
  const install = document.querySelector('[data-action="update-install"]');
  install.hidden = status.stage !== 'ready';
  install.disabled = status.stage !== 'ready';
}
async function openDesktopUpdates() {
  if (!window.xiaoyuDesktop?.updates) return;
  localModal('软件更新', `<p id="update-current-version" class="small muted"></p>
    <p id="update-target-version"></p>
    <div class="field mt-16"><label class="row gap-8">
      <input type="checkbox" id="update-automatic">自动检查并下载更新</label></div>
    <p id="update-status" class="remote-feedback" role="status" aria-live="polite"></p>
    <progress id="update-progress" max="100" value="0" hidden></progress>
    <p id="update-checked-at" class="small muted"></p>
    <details class="mt-16"><summary>GitHub 令牌（可选）</summary>
      <p class="small muted">更新源为公开仓库，通常无需登录即可检查。网络受限或遇到 GitHub 访问频率限制时，可填写仅授权 ZHIXU 仓库 Contents 只读权限的令牌；凭据仅加密保存在本机。</p>
      <div class="field"><label for="update-token">GitHub 令牌</label>
        <input class="input" id="update-token" type="password" autocomplete="off" maxlength="4096" placeholder="留空则匿名检查或沿用已有令牌"></div>
      <p id="update-access" class="small muted"></p>
      <button class="btn btn-sm" data-action="update-clear">移除保存的凭据</button>
    </details>`,
    `<button class="btn" data-action="update-save">保存设置</button>
     <button class="btn" data-action="update-check">${icon('refresh', 14)} 检查更新</button>
     <button class="btn btn-primary" data-action="update-install" hidden>${icon('download', 14)} 重启并更新</button>`, 'update-modal');
  try {
    const status = await window.xiaoyuDesktop.updates({ operation: 'status' });
    if (!document.getElementById('update-status')) return;
    document.getElementById('update-automatic').checked = status.automatic;
    paintDesktopUpdate(status);
  } catch (error) {
    const output = document.getElementById('update-status');
    if (output) output.textContent = error.message;
  }
}
async function desktopUpdateAction(action) {
  if (action === 'update-settings') { await openDesktopUpdates(); return; }
  const output = document.getElementById('update-status');
  try {
    const operation = action.slice('update-'.length);
    if (operation === 'install' && !confirm('保存当前工作并重启知序以完成更新？网页访问会暂时断开。')) return;
    const request = operation === 'save' || operation === 'clear' ? {
      operation: 'configure', automatic: document.getElementById('update-automatic').checked,
      token: document.getElementById('update-token').value || undefined, clearToken: operation === 'clear'
    } : { operation };
    const status = await window.xiaoyuDesktop.updates(request);
    if (document.getElementById('update-token')) document.getElementById('update-token').value = '';
    paintDesktopUpdate(status);
  } catch (error) { if (output?.isConnected) output.textContent = error.message; }
}
async function prepareWorkbenchUpdate() {
  if (!workbenchReady || state.chatSending || state.documentImportBusy || state.documentReparsing || state.documentAnalyzing ||
      state.providerDiagnosing || Object.values(state.integrationBusy || {}).some(Boolean) ||
      DB.runningTimer || document.getElementById('workbench-sync-notice') ||
      document.querySelector('#modal-root .modal:not(.update-modal)')) return false;
  if (document.getElementById('chat-input')?.value.trim()) return false;
  await persistWorkbench();
  return true;
}
function initializeDesktopUpdates() {
  if (!window.xiaoyuDesktop?.updates || window.xiaoyuDesktop.isRemote) return;
  window.xiaoyuDesktop.onUpdate?.(paintDesktopUpdate);
  void window.xiaoyuDesktop.updates({ operation: 'status' }).then(paintDesktopUpdate).catch(() => {});
}
