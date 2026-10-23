/* Connector credentials live only in encrypted desktop settings. */
const INTEGRATIONS = {
  feishu: {
    help: '使用企业自建应用的凭据。填写群 Chat ID 后，需在飞书开放平台开通消息读取权限，并让应用加入该群。',
    sync: true,
    fields: [['appId', 'App ID'], ['appSecret', 'App Secret', 'password'], ['chatId', '群 Chat ID（读取消息时必填）', 'text', true]]
  },
  dingtalk: {
    help: '使用钉钉企业内部应用的 AppKey 和 AppSecret。当前支持应用认证，消息接收尚未接入。',
    fields: [['appKey', 'AppKey'], ['appSecret', 'AppSecret', 'password']]
  },
  wecom: {
    help: '使用企业 ID 和应用 Secret，必要时将本机公网 IP 加入应用可信 IP。当前支持应用认证，消息接收尚未接入。',
    fields: [['corpId', '企业 ID（CorpID）'], ['corpSecret', '应用 Secret', 'password']]
  },
  mail: {
    help: '请在邮箱中开启 IMAP，密码填写邮箱授权码。使用 SSL/TLS 连接，每次只读最近 20 封，不改变已读状态、不保存附件；大邮件仅导入标题。',
    sync: true,
    fields: [['host', 'IMAP 服务器'], ['port', 'SSL/TLS 端口', 'number', false, '993'], ['user', '邮箱账号'],
      ['password', '邮箱授权码 / 密码', 'password'], ['folder', '邮件文件夹', 'text', false, 'INBOX']]
  },
  ics: {
    help: '填写日历提供的 ICS 订阅地址。手动同步未来 30 天日程到收件箱，重复同步不会重复创建。',
    sync: true,
    fields: [['url', 'ICS 订阅地址（包含私密令牌时按密码保护）', 'password']]
  }
};

function initializeIntegrations() {
  DB.settings = DB.settings || {};
  DB.settings.integrations = DB.settings.integrations || {};
  DB.integrationState = DB.integrationState || {};
  DB.integrationLogs = DB.integrationLogs || [];
  DB.integrationReceipts = DB.integrationReceipts || [];
  // Remove prototype connection indicators, including snapshots saved by older versions.
  DB.connectors.forEach(c => { c.status = 'off'; });
}

function integrationStatus(id) {
  if (!INTEGRATIONS[id]) return { on: false, label: '尚未接入', meta: '开发中' };
  const config = DB.settings.integrations[id];
  const result = DB.integrationState[id];
  if (!config) return { on: false, label: '未配置', meta: '尚未验证' };
  if (result?.status === 'error') return { on: false, label: '验证失败', meta: '请检查配置后重试' };
  if (result?.status === 'verified') return {
    on: true, label: result.mode === 'auth' ? '应用认证通过' : '读取权限已验证',
    meta: result.lastSync ? new Date(result.lastSync).toLocaleString('zh-CN') : '手动同步'
  };
  return { on: false, label: '已保存 · 待验证', meta: '尚未测试连接' };
}

function addIntegrationLog(id, action, ok, message, count = 0) {
  DB.integrationLogs.unshift({ id: newRecordId('sync'), connectorId: id, action, ok, message, count, time: new Date().toISOString() });
  DB.integrationLogs = DB.integrationLogs.slice(0, 100);
}

function openIntegrationPicker() {
  const choices = DB.connectors.filter(c => INTEGRATIONS[c.id]);
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="选择连接器">
        <div class="modal-head"><h2>选择连接器</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
        <div class="modal-body integration-choices">
          ${choices.map(c => `<button class="btn" data-action="connector-config" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

function openIntegration(id) {
  if (id === 'manual') { state.dataTab = 'plugins'; state.view = 'data'; render(); return; }
  const connector = DB.connectors.find(c => c.id === id);
  if (!connector) return;
  const definition = INTEGRATIONS[id];
  if (!definition) { showToast(`${connector.name}尚未接入，当前可配置飞书、钉钉、企业微信、IMAP 和 ICS`); return; }
  state.integrationId = id;
  const config = DB.settings.integrations[id] || {};
  const status = integrationStatus(id);
  const busy = !!state.integrationBusy?.[id];
  const canSave = !!window.xiaoyuDesktop?.integration && !busy;
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal integration-modal" role="dialog" aria-modal="true" aria-label="${esc(connector.name)}配置">
        <div class="modal-head"><h2>${esc(connector.name)}配置</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
        <div class="modal-body">
          <p class="small muted">${esc(definition.help)}</p>
          ${!window.xiaoyuDesktop?.integration ? '<p class="integration-notice">请使用桌面测试版保存和验证连接器；浏览器预览不保存连接密码。</p>' : ''}
          <div class="integration-fields">
            ${definition.fields.map(([key, label, type = 'text', optional, defaultValue]) => `
              <div class="field"><label for="integration-${key}">${esc(label)}${optional ? '' : ' *'}</label>
                <input class="input" id="integration-${key}" type="${type}" maxlength="4096" autocomplete="off"
                  value="${type === 'password' ? '' : esc(config[key] || defaultValue || '')}"
                  placeholder="${type === 'password' && config[key] ? '已保存，留空保留；输入可替换' : ''}"
                  ${type === 'number' ? 'min="1" max="65535" step="1"' : ''}></div>
            `).join('')}
          </div>
          <div class="integration-result" id="integration-result" role="status">${busy ? '正在连接，请稍候…' : esc(DB.integrationState[id]?.message || status.label)}</div>
        </div>
        <div class="modal-foot integration-actions">
          ${config && Object.keys(config).length ? `<button class="btn btn-danger" data-action="connector-disconnect" ${busy ? 'disabled' : ''}>${icon('x', 13)} 断开</button>` : ''}
          <button class="btn" data-action="connector-save" ${canSave ? '' : 'disabled'}>${icon('check', 13)} 保存配置</button>
          <button class="btn btn-primary" data-action="connector-test" ${canSave ? '' : 'disabled'}>${icon('zap', 13)} 保存并测试</button>
          ${definition.sync ? `<button class="btn" data-action="connector-sync" ${canSave ? '' : 'disabled'}>${icon('refresh', 13)} 保存并同步</button>` : ''}
        </div>
      </div>
    </div>`;
}

function readIntegrationForm() {
  const id = state.integrationId;
  const definition = INTEGRATIONS[id];
  if (!definition) return null;
  const existing = DB.settings.integrations[id] || {};
  const config = {};
  for (const [key, , type = 'text', optional, defaultValue] of definition.fields) {
    const field = document.getElementById('integration-' + key);
    if (!field) return null;
    const value = (type === 'password' ? field.value : field.value.trim()) ||
      (type === 'password' ? existing[key] : '') || defaultValue || '';
    if ((!optional && !value) || (type === 'number' && !field.checkValidity())) {
      showToast('请填写全部必填项，并检查服务器端口');
      field.focus();
      return null;
    }
    config[key] = value;
  }
  return config;
}

async function saveIntegration(keepOpen = false) {
  const id = state.integrationId;
  if (!window.xiaoyuDesktop?.integration || state.integrationBusy?.[id]) return null;
  const config = readIntegrationForm();
  if (!config) return null;
  const changed = JSON.stringify(config) !== JSON.stringify(DB.settings.integrations[id]);
  DB.settings.integrations[id] = config;
  saveSettings();
  if (changed) DB.integrationState[id] = { status: 'configured', message: '配置已保存，尚未验证' };
  try { await persistWorkbench(); }
  catch { return null; }
  if (!keepOpen) {
    openIntegration(id);
    render();
    showToast('配置已加密保存');
  }
  return config;
}

function importIntegrationRecords(id, records) {
  const existing = new Set([...DB.inbox, ...(DB.inboxArchive || []), ...(DB.integrationReceipts || [])]
    .filter(item => item.connectorId === id).map(item => item.externalId));
  let count = 0;
  const source = DB.connectors.find(c => c.id === id)?.name || id;
  for (const record of records) {
    if (!record.externalId || existing.has(record.externalId)) continue;
    DB.inbox.unshift({
      id: newRecordId('inbox'), connectorId: id, externalId: record.externalId,
      title: record.title, raw: record.raw, source, sourceType: id === 'mail' ? 'client' : 'self',
      person: source, time: '刚刚', project: null, confidence: 0, alternatives: [],
      due: record.date || '待确认', p50: '1h', p90: '2h', basis: '外部来源，待人工确认',
      priority: 'P2', type: '待分类', subtasks: [], note: '外部原文已保留，请确认后转为任务'
    });
    existing.add(record.externalId);
    count++;
  }
  return count;
}

async function executeIntegration(operation) {
  const id = state.integrationId;
  const config = await saveIntegration(true);
  if (!config || state.integrationBusy?.[id]) return;
  state.integrationBusy = state.integrationBusy || {};
  state.integrationBusy[id] = true;
  openIntegration(id);
  try {
    const result = await window.xiaoyuDesktop.integration({ id, config, operation });
    // Discard responses if the configuration was disconnected or changed while the request ran.
    if (JSON.stringify(DB.settings.integrations[id]) !== JSON.stringify(config)) return;
    const count = operation === 'sync' ? importIntegrationRecords(id, result.records) : 0;
    DB.integrationState[id] = {
      ...DB.integrationState[id], status: 'verified', mode: result.mode,
      message: result.message + (operation === 'sync' ? `；本次新增 ${count} 条收件箱记录` : ''),
      verifiedAt: new Date().toISOString(),
      ...(operation === 'sync' ? { lastSync: new Date().toISOString() } : {})
    };
    addIntegrationLog(id, operation, true, result.message, count);
  } catch (error) {
    DB.integrationState[id] = {
      ...DB.integrationState[id], status: 'error',
      message: String(error.message || '连接失败').replace(/^Error invoking remote method '[^']+': Error: /, '')
    };
    addIntegrationLog(id, operation, false, DB.integrationState[id].message);
  } finally {
    state.integrationBusy[id] = false;
    render();
    if (document.querySelector('.integration-modal') && state.integrationId === id) openIntegration(id);
    await persistWorkbench().catch(() => {});
  }
}

async function disconnectIntegration() {
  const id = state.integrationId;
  if (state.integrationBusy?.[id]) return;
  delete DB.settings.integrations[id];
  delete DB.integrationState[id];
  // Old profiles may also have a settings preference; keep both encrypted copies in agreement.
  if (storageGet('jw-settings')) saveSettings();
  addIntegrationLog(id, 'disconnect', true, '连接配置已移除，已导入的原文保留');
  closeModal();
  render();
  await persistWorkbench().catch(() => {});
}

function openIntegrationLogs() {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal lg" role="dialog" aria-modal="true" aria-label="同步日志">
        <div class="modal-head"><h2>同步日志</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
        <div class="modal-body">
          ${DB.integrationLogs.length ? `<div class="integration-log-list">${DB.integrationLogs.map(log => `
            <div class="integration-log">
              <div><b>${esc(DB.connectors.find(c => c.id === log.connectorId)?.name || log.connectorId)}</b>
                <span class="chip ${log.ok ? 'green' : 'red'}">${log.ok ? '成功' : '失败'}</span>
                <time>${esc(new Date(log.time).toLocaleString('zh-CN'))}</time></div>
              <p>${esc(log.message)}${log.action === 'sync' ? ` · 新增 ${log.count} 条` : ''}</p>
            </div>`).join('')}</div>` : '<p class="muted">暂无连接测试或同步记录。</p>'}
        </div>
      </div>
    </div>`;
}
