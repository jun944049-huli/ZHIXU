/* Modals: quick capture, command palette, insert-impact analysis */

function closeModal() {
  if (state.polishTimer) {
    clearTimeout(state.polishTimer);
    state.polishTimer = null;
  }
  state.polishRequestId += 1;
  state.polishLoading = false;
  state.projectStakeholderDraft = null;
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

function showToast(msg) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="check-ic">${icon('check', 14)}</span><span>${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, 6px)';
    el.style.transition = 'opacity .2s ease, transform .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

function deriveInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  if (/^[A-Za-z]/.test(s)) {
    return s.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
  return s.slice(0, 2);
}

function projectStakeholderRows() {
  return (state.projectStakeholderDraft || []).map((person, index) => `
    <div class="stakeholder-editor-row" data-stakeholder-id="${esc(person.id)}" role="group" aria-label="干系人 ${index + 1}">
      <div class="field"><label for="stakeholder-name-${esc(person.id)}">姓名 *</label>
        <input class="input" id="stakeholder-name-${esc(person.id)}" data-stakeholder-name maxlength="80" value="${esc(person.name)}" required></div>
      <div class="field"><label for="stakeholder-role-${esc(person.id)}">角色</label>
        <input class="input" id="stakeholder-role-${esc(person.id)}" data-stakeholder-role maxlength="80" value="${esc(person.role)}" placeholder="例如 客户、项目经理"></div>
      <button class="icon-btn" data-action="project-stakeholder-remove" data-id="${esc(person.id)}" title="移除干系人" aria-label="移除干系人 ${index + 1}">${icon('trash', 15)}</button>
    </div>`).join('') || '<p class="small muted">尚未添加干系人</p>';
}

function changeProjectStakeholder(removeId) {
  const people = readProjectStakeholders();
  if (!people) return;
  state.projectStakeholderDraft = removeId
    ? people.filter(person => person.id !== removeId)
    : [...people, { id: newRecordId('stakeholder'), name: '', role: '', c: DB.user.color }];
  document.getElementById('project-stakeholder-list').innerHTML = projectStakeholderRows();
  document.getElementById('project-stakeholder-error').hidden = true;
  if (!removeId) {
    document.querySelector('.stakeholder-editor-row:last-child [data-stakeholder-name]').focus();
  } else {
    document.querySelector('[data-action="project-stakeholder-add"]').focus();
  }
}

function openProjectEditor(id, focusStakeholders = false) {
  const project = id ? projectById(id) : null;
  if (id && !project) { showToast('项目已不存在'); return; }
  state.editProjectId = project?.id || null;
  const p = project || {
    name: '', code: '', goal: '', owner: DB.user.name, progress: 0,
    health: 'green', next: '', nextDate: ''
  };
  state.projectStakeholderDraft = (project ? detailForProject(project).stakeholders : []).map(person => ({
    ...person, id: person.id || newRecordId('stakeholder')
  }));
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal project-editor" role="dialog" aria-modal="true" aria-label="${project ? '编辑项目' : '新建项目'}">
        <div class="modal-head">
          <h2>${project ? '编辑项目' : '新建项目'}</h2>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>
        <div class="modal-body form-grid">
          <div class="field full"><label for="project-name">项目名称 *</label>
            <input class="input" id="project-name" maxlength="80" value="${esc(p.name)}" required></div>
          <div class="field"><label for="project-code">项目代号</label>
            <input class="input" id="project-code" maxlength="20" value="${esc(p.code)}"></div>
          <div class="field"><label for="project-owner">负责人</label>
            <input class="input" id="project-owner" maxlength="40" value="${esc(p.owner)}"></div>
          <div class="field full"><label for="project-goal">目标</label>
            <textarea class="input" id="project-goal" maxlength="1000" rows="3">${esc(p.goal)}</textarea></div>
          <div class="field"><label for="project-progress">完成进度（%）</label>
            <input class="input" id="project-progress" type="number" min="0" max="100" step="1" value="${p.progress}"></div>
          <div class="field"><label for="project-health">健康度</label>
            <select class="select" id="project-health">
              ${['green', 'amber', 'red'].map(h => `<option value="${h}" ${p.health === h ? 'selected' : ''}>${healthLabel(h)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="project-next">下一节点</label>
            <input class="input" id="project-next" maxlength="80" value="${esc(p.next === '未安排' ? '' : p.next)}"></div>
          <div class="field"><label for="project-next-date">节点日期</label>
            <input class="input" id="project-next-date" maxlength="30" value="${esc(p.nextDate === '—' ? '' : p.nextDate)}" placeholder="例如 2026-11-01"></div>
          <section class="project-stakeholders full" aria-labelledby="project-stakeholders-title">
            <div class="stakeholder-editor-head row gap-8">
              <h3 id="project-stakeholders-title">干系人</h3>
              <button class="btn btn-sm" data-action="project-stakeholder-add">${icon('plus', 13)} 添加干系人</button>
            </div>
            <div id="project-stakeholder-list">${projectStakeholderRows()}</div>
            <p class="stakeholder-error small" id="project-stakeholder-error" role="alert" hidden></p>
          </section>
          ${customFieldInputs('project', p)}
        </div>
        <div class="modal-foot">
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-primary" data-action="save-project">${icon('check', 13)} 保存项目</button>
        </div>
      </div>
    </div>`;
  if (focusStakeholders) {
    document.getElementById('project-stakeholders-title').scrollIntoView({ block: 'center' });
    (document.querySelector('[data-stakeholder-name]') ||
      document.querySelector('[data-action="project-stakeholder-add"]')).focus();
  } else document.getElementById('project-name').focus();
}

function openProjectDelete(id) {
  const project = projectById(id);
  if (!project) { showToast('项目已不存在'); return; }
  state.deleteProjectId = id;
  const count = allWorkbenchTasks().filter(t => t.project === id).length;
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal project-editor" role="dialog" aria-modal="true" aria-label="删除项目">
        <div class="modal-head">
          <h2>删除项目</h2>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <p>确定删除「${esc(project.name)}」？</p>
          <p class="muted mt-12">${count} 条关联任务将保留并改为未归属；项目记录将归档。</p>
        </div>
        <div class="modal-foot">
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-danger" data-action="confirm-delete-project">${icon('trash', 13)} 确认删除</button>
        </div>
      </div>
    </div>`;
}

function openProfileSettings() {
  const u = DB.user;
  const colors = ['#2F5BE3', '#1F8A70', '#C07A2B', '#6B5BD2', '#B85C7A', '#4C7A3F', '#4B5563'];
  const custom = (DB.settings && DB.settings.customProvider) || {};
  const activeProvider = (DB.settings && DB.settings.aiProvider) || (deepseekKey() ? 'deepseek' : 'local');
  const detected = custom.detected || detectAIProvider(custom.baseUrl, custom.model);
  state.profileDraft = { color: u.color, assistantName: assistantName(), customProviderActive: activeProvider === 'custom' };
  state.customProviderTested = false;
  state.customProviderFingerprint = '';
  state.customProviderModels = custom.model ? [custom.model] : [];
  state.customProviderAutoModel = custom.model || '';
  state.customProviderSession = {};
  clearTimeout(state.customProviderFetchTimer);
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal profile-modal" style="width:min(560px, calc(100vw - 40px))" role="dialog" aria-modal="true" aria-label="个人资料与设置">
        <div class="modal-head">
          <div class="ai-orb">${icon('settings', 16)}</div>
          <div>
            <h2>个人资料与设置</h2>
            <p class="sub">管理姓名、角色与助手名称；左上角工作区会自动跟随姓名。</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>

        <div class="modal-body">
          <div class="profile-preview">
            <span class="avatar lg" id="profile-avatar" style="background:${u.color}">${esc(u.initials)}</span>
            <div>
              <div class="profile-preview-name" id="profile-preview-name">${esc(u.name)}</div>
              <div class="profile-preview-role" id="profile-preview-role">${esc(u.role)}</div>
            </div>
            <span class="chip outline">${icon('lock', 11)} 本地资料</span>
          </div>

          <div class="form-grid">
            <div class="field">
              <label>姓名</label>
              <input class="input" id="profile-name" value="${esc(u.name)}" maxlength="20">
            </div>
            <div class="field">
              <label>头像缩写</label>
              <input class="input" id="profile-initials" value="${esc(u.initials)}" maxlength="2">
            </div>

            <div class="field full">
              <label>角色 / 职位</label>
              <input class="input" id="profile-role" list="role-options" value="${esc(u.role)}" maxlength="30" placeholder="例如：项目负责人">
              <datalist id="role-options">
                <option value="项目负责人">
                <option value="产品经理">
                <option value="技术负责人">
                <option value="交付负责人">
                <option value="设计负责人">
                <option value="独立开发者">
                <option value="团队负责人">
              </datalist>
              <div class="hint">会显示在左下角，也会作为新项目的默认负责人。</div>
            </div>

            <div class="field full">
              <label>头像颜色</label>
              <div class="color-swatches">
                ${colors.map(c => `<button class="color-swatch ${c === u.color ? 'on' : ''}" style="background:${c}" data-action="avatar-color" data-color="${c}" aria-label="选择颜色 ${c}"></button>`).join('')}
              </div>
            </div>

            <div class="field full settings-field">
              <label>${icon('sparkles', 11)} 助手名称</label>
              <input class="input" id="profile-assistant-name" value="${esc(assistantName())}" maxlength="12" placeholder="小鱼">
              <div class="hint">显示在侧边栏、对话标题、页面标题与命令面板。默认：小鱼。</div>
            </div>

            <div class="field full settings-field">
              <label>${icon('zap', 11)} DeepSeek API Key ${activeProvider === 'deepseek' ? '<span class="chip green">当前</span>' : ''}</label>
              <div class="row gap-6">
                <input class="input" id="profile-deepseek-key" type="password" value="${esc(DB.settings.deepseekKey || '')}" placeholder="sk-..." autocomplete="off" spellcheck="false" style="flex:1">
                <button class="btn btn-sm" data-action="test-deepseek">${icon('zap', 11)} 测试连接</button>
              </div>
              <div class="hint" id="deepseek-test-result">${window.xiaoyuDesktop ? '密钥使用系统安全存储加密，留空时润色使用本地规则。' : '仅保存在本机浏览器；留空时润色使用本地规则。代理只监听 127.0.0.1。'}</div>
            </div>

            <div class="field full settings-field custom-provider-box">
              <div class="custom-provider-head">
                <label>${icon('link', 11)} 自定义供应商</label>
                <span class="chip ${activeProvider === 'custom' ? 'green' : 'outline'}" id="custom-provider-current">${activeProvider === 'custom' ? '当前供应商' : '可选'}</span>
              </div>
              <div class="custom-provider-grid">
                <div class="field">
                  <label>供应商名称</label>
                  <input class="input" id="custom-provider-name" value="${esc(custom.name || '')}" placeholder="自动识别" maxlength="30">
                </div>
                <div class="field">
                  <label for="custom-provider-protocol">接入协议</label>
                  <select class="select" id="custom-provider-protocol">
                    ${[['auto', '自动识别'], ['chat', 'Chat Completions'], ['responses', 'Responses API']].map(([value, label]) =>
                      `<option value="${value}" ${value === (custom.protocol || 'auto') ? 'selected' : ''}>${label}</option>`).join('')}
                  </select>
                </div>
                <div class="field full">
                  <label>API Base URL</label>
                  <input class="input" id="custom-provider-base" value="${esc(custom.baseUrl || '')}" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false">
                </div>
                <div class="field full">
                  <label>API Key</label>
                  <div class="row gap-6">
                    <input class="input" id="custom-provider-key" type="password" value="${esc(custom.apiKey || '')}" placeholder="sk-..." autocomplete="off" spellcheck="false" style="flex:1">
                  </div>
                </div>
                <div class="field full">
                  <label for="custom-provider-model-select">可用模型</label>
                  <div class="provider-model-controls">
                    <select class="select" id="custom-provider-model-select"><option value="">填写地址与密钥后自动获取</option>
                      ${custom.model ? `<option value="${esc(custom.model)}" selected>${esc(custom.model)}</option>` : ''}</select>
                    <button class="btn btn-sm" data-action="fetch-custom-models">${icon('refresh', 12)} 获取模型</button>
                  </div>
                  <label class="tiny muted" for="custom-provider-model">当前模型 / 手动填写</label>
                  <input class="input" id="custom-provider-model" value="${esc(custom.model || '')}" placeholder="自动选取文本模型，也可手动填写" maxlength="120" autocomplete="off" spellcheck="false">
                </div>
              </div>
              <div class="custom-provider-detected">
                <span class="tiny muted">识别结果</span>
                <span class="chip outline" id="custom-provider-detected">${esc(detected || '等待输入')}</span>
              </div>
              <div class="hint" id="custom-provider-result" role="status" aria-live="polite">填入 API 地址与密钥后自动获取模型。诊断会向当前供应商发送一条简短测试请求，可能产生少量费用。</div>
              <button class="btn btn-sm" data-action="test-custom-provider">${icon('zap', 12)} 诊断供应商</button>
              <div id="custom-provider-diagnosis" class="provider-diagnosis" aria-live="polite"></div>
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <div class="left">
            <span class="chip outline">${icon('shield', 11)} 仅本地存储</span>
          </div>
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-primary" data-action="save-profile">${icon('check', 13)} 保存</button>
        </div>
      </div>
    </div>
  `;
}

function setAvatarColor(color) {
  state.profileDraft.color = color;
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('on', el.dataset.color === color);
  });
  const av = document.getElementById('profile-avatar');
  if (av) av.style.background = color;
}

async function saveProfile() {
  const nameEl = document.getElementById('profile-name');
  const roleEl = document.getElementById('profile-role');
  const iniEl = document.getElementById('profile-initials');
  const assistantEl = document.getElementById('profile-assistant-name');
  const deepseekEl = document.getElementById('profile-deepseek-key');
  const customNameEl = document.getElementById('custom-provider-name');
  const customModelEl = document.getElementById('custom-provider-model');
  const customBaseEl = document.getElementById('custom-provider-base');
  const customKeyEl = document.getElementById('custom-provider-key');
  if (!nameEl || !roleEl || !iniEl) return;

  const oldName = DB.user.name;
  const name = nameEl.value.trim() || oldName;
  const role = roleEl.value.trim() || '项目负责人';
  const workspace = name + '的工作台';
  const initials = (iniEl.value.trim() || deriveInitials(name)).slice(0, 2);
  const color = state.profileDraft.color || DB.user.color;
  const assistant = ((assistantEl && assistantEl.value.trim()) || '小鱼').slice(0, 12);
  const deepseek = deepseekEl ? deepseekEl.value.trim() : String((DB.settings && DB.settings.deepseekKey) || '');
  const customName = customNameEl ? customNameEl.value.trim() : '';
  let customModel = customModelEl ? customModelEl.value.trim() : '';
  const customBase = customBaseEl ? customBaseEl.value.trim().replace(/\/+$/, '') : '';
  const customKey = customKeyEl ? customKeyEl.value.trim() : '';
  if (customBase && customKey && !customModel) {
    await fetchCustomProviderModels();
    customModel = customModelEl ? customModelEl.value.trim() : '';
    if (document.getElementById('profile-name') !== nameEl) return;
    if (customBaseEl.value.trim().replace(/\/+$/, '') !== customBase || customKeyEl.value.trim() !== customKey) {
      showToast('供应商配置已改变，请重新保存');
      return;
    }
  }
  const customHasAny = !!(customName || customModel || customBase || customKey);

  if (customHasAny && !(customBase && customKey && customModel)) {
    showToast('自定义供应商需要填写 Base URL、API Key 和模型');
    return;
  }

  DB.user.name = name;
  DB.user.role = role;
  DB.user.workspace = workspace;
  DB.user.initials = initials;
  DB.user.color = color;
  DB.settings = DB.settings || {};
  DB.settings.assistantName = assistant;
  DB.settings.deepseekKey = deepseek;

  if (customHasAny) {
    const detected = detectAIProvider(customBase, customModel);
    const resolvedName = customName || detected || '自定义供应商';
    DB.settings.customProvider = {
      name: resolvedName,
      baseUrl: customBase,
      apiKey: customKey,
      model: customModel,
      protocol: document.getElementById('custom-provider-protocol')?.value || 'auto',
      detected,
      testedAt: state.customProviderTested && state.customProviderFingerprint === customProviderFingerprint()
        ? new Date().toISOString()
        : ''
    };
    DB.settings.aiProvider = 'custom';
  } else {
    delete DB.settings.customProvider;
    DB.settings.aiProvider = deepseek ? 'deepseek' : 'local';
  }
  state.chatModel = chatModelLabel();
  try { storageSet('jw-chat-model', state.chatModel); } catch (e) { /* ignore */ }

  DB.projects.forEach(p => {
    if (p.owner === oldName) p.owner = name;
  });
  Object.values(DB.projectDetails || {}).forEach(d => {
    (d.stakeholders || []).forEach(s => {
      if (s.name === oldName) s.name = name;
    });
  });

  try { storageSet('jw-profile', JSON.stringify({ name, role, initials, color })); } catch (e) { /* ignore */ }
  saveSettings();
  closeModal();
  render();
  showToast('已保存 · 当前供应商 ' + aiProviderName());
}

async function testDeepSeek() {
  const input = document.getElementById('profile-deepseek-key');
  const hint = document.getElementById('deepseek-test-result');
  const key = input ? input.value.trim() : '';
  if (!key) {
    if (hint) hint.textContent = '请先填入 DeepSeek API Key。';
    showToast('请先填入 DeepSeek API Key');
    return;
  }
  if (hint) hint.textContent = '正在连接 DeepSeek…';
  try {
    const res = await requestPolish({ text: '测试连接', tone: '简洁', apiKey: key, model: 'deepseek-chat' });
    let data = null;
    try { data = await res.json(); } catch (err) { /* static server may return HTML */ }
    if (!res.ok) {
      if (res.status === 404 || res.status === 501) {
        throw new Error('未启动代理，请用 python server.py 启动预览');
      }
      throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    }
    if (hint) hint.textContent = '连接成功 · DeepSeek 可用。保存后会用于润色。';
    showToast('DeepSeek 连接成功');
  } catch (err) {
    if (hint) hint.textContent = '连接失败：' + ((err && err.message) || '未知错误');
    showToast('DeepSeek 连接失败');
  }
}

function updateCustomProviderDetection() {
  const baseEl = document.getElementById('custom-provider-base');
  const modelEl = document.getElementById('custom-provider-model');
  const nameEl = document.getElementById('custom-provider-name');
  const detectedEl = document.getElementById('custom-provider-detected');
  if (!detectedEl) return;
  const detected = detectAIProvider(baseEl ? baseEl.value : '', modelEl ? modelEl.value : '');
  detectedEl.textContent = detected || '等待输入';
  detectedEl.className = 'chip ' + (detected && detected !== 'OpenAI 兼容' ? 'green' : 'outline');
  if (nameEl && !nameEl.value.trim()) nameEl.placeholder = detected || '自动识别';
}

function customProviderForm() {
  return { baseUrl: document.getElementById('custom-provider-base')?.value.trim().replace(/\/+$/, '') || '',
    apiKey: document.getElementById('custom-provider-key')?.value.trim() || '',
    model: document.getElementById('custom-provider-model')?.value.trim() || '',
    protocol: document.getElementById('custom-provider-protocol')?.value || 'auto' };
}

function customProviderFingerprint() { return JSON.stringify(customProviderForm()); }

function invalidateCustomProvider(id) {
  state.customProviderTested = false;
  state.customProviderFingerprint = '';
  const panel = document.getElementById('custom-provider-diagnosis');
  if (panel) panel.innerHTML = '';
  const current = document.getElementById('custom-provider-current');
  if (current) { current.className = 'chip outline'; current.textContent = '配置已修改，待诊断'; }
  const select = document.getElementById('custom-provider-model-select');
  if (id === 'custom-provider-model') {
    state.customProviderAutoModel = '';
    if (select) select.value = customProviderForm().model;
  }
  if (['custom-provider-base', 'custom-provider-key'].includes(id)) {
    const model = document.getElementById('custom-provider-model');
    if (model && model.value === state.customProviderAutoModel) model.value = '';
    state.customProviderAutoModel = '';
    state.customProviderModels = [];
    if (select) select.innerHTML = '<option value="">等待获取模型</option>';
    clearTimeout(state.customProviderFetchTimer);
    const session = state.customProviderSession;
    state.customProviderFetchTimer = setTimeout(() => {
      if (session === state.customProviderSession && document.getElementById('custom-provider-key')) {
        const config = customProviderForm();
        if (config.baseUrl && config.apiKey) void fetchCustomProviderModels();
      }
    }, 1000);
  }
}

function fillCustomProviderModels(models) {
  const input = document.getElementById('custom-provider-model');
  const select = document.getElementById('custom-provider-model-select');
  if (!input || !select) return;
  state.customProviderModels = models;
  if (!input.value.trim()) {
    input.value = models.find(model => !/embed|rerank|whisper|tts|image|dall-e|moderation|audio|video/i.test(model)) || '';
    state.customProviderAutoModel = input.value;
  }
  select.innerHTML = '<option value="">手动填写模型</option>' + models.map(model =>
    `<option value="${esc(model)}">${esc(model)}</option>`).join('');
  select.value = models.includes(input.value) ? input.value : '';
  updateCustomProviderDetection();
}

async function fetchCustomProviderModels() {
  clearTimeout(state.customProviderFetchTimer);
  const config = customProviderForm();
  const hint = document.getElementById('custom-provider-result');
  const session = state.customProviderSession;
  const requestId = state.customProviderModelsRequest = {};
  if (!hint) return;
  if (!config.baseUrl || !config.apiKey) { hint.textContent = '请填写 API 地址与 API Key。'; return; }
  if (!window.xiaoyuDesktop?.providerModels) { hint.textContent = '模型自动获取与接口诊断请使用更新后的桌面版。'; return; }
  hint.textContent = '正在从供应商获取模型列表…';
  try {
    const result = await window.xiaoyuDesktop.providerModels(config);
    const now = customProviderForm();
    if (state.customProviderSession !== session || !hint.isConnected || requestId !== state.customProviderModelsRequest ||
        now.baseUrl !== config.baseUrl || now.apiKey !== config.apiKey) return;
    fillCustomProviderModels(result.models);
    hint.textContent = `已获取 ${result.models.length} 个模型${now.model && !result.models.includes(now.model) ? '；当前手填模型未在列表中，已保留，请诊断确认。' : '，可在列表中选择。'}`;
  } catch (error) {
    const now = customProviderForm();
    if (state.customProviderSession !== session || !hint.isConnected || requestId !== state.customProviderModelsRequest ||
        now.baseUrl !== config.baseUrl || now.apiKey !== config.apiKey) return;
    hint.textContent = '模型获取失败：' + documentFailureReason(error) + '；可重试，或手动填写模型后诊断。';
  }
}

async function testCustomProvider() {
  clearTimeout(state.customProviderFetchTimer);
  state.customProviderModelsRequest = {};
  const config = customProviderForm();
  const fingerprint = customProviderFingerprint();
  const session = state.customProviderSession;
  const hint = document.getElementById('custom-provider-result');
  const panel = document.getElementById('custom-provider-diagnosis');
  const button = document.querySelector('[data-action="test-custom-provider"]');
  if (!hint || !panel || button?.disabled) return;
  if (!window.xiaoyuDesktop?.providerDiagnose) { hint.textContent = '接口诊断请使用更新后的桌面版。'; return; }
  state.customProviderTested = false;
  hint.textContent = '正在检查配置、模型列表与真实文本请求…';
  panel.innerHTML = '';
  if (button) button.disabled = true;
  try {
    const report = await window.xiaoyuDesktop.providerDiagnose(config);
    if (session !== state.customProviderSession || !panel.isConnected || fingerprint !== customProviderFingerprint()) return;
    if (report.models.length) fillCustomProviderModels(report.models);
    if (report.model && !document.getElementById('custom-provider-model').value) {
      document.getElementById('custom-provider-model').value = report.model;
    }
    if (report.ok && report.protocol) document.getElementById('custom-provider-protocol').value = report.protocol;
    state.customProviderTested = report.ok;
    state.customProviderFingerprint = report.ok ? customProviderFingerprint() : '';
    panel.innerHTML = [...report.checks, { name: '处理建议', status: report.ok ? 'pass' : 'warn', detail: report.suggestion }]
      .map(check => `<div class="provider-check ${check.status}">
        <b>${icon(check.status === 'pass' ? 'check' : check.status === 'fail' ? 'x' : 'alert', 14)} ${esc(check.name)}
          <span>${check.status === 'pass' ? '通过' : check.status === 'fail' ? '失败' : '需留意'}</span></b>
        ${check.endpoint ? `<p class="provider-endpoint">${esc(check.endpoint)}</p>` : ''}
        <p>${esc(check.detail)}</p>${check.durationMs != null ? `<small>${check.durationMs} ms</small>` : ''}</div>`).join('');
    hint.textContent = report.ok ? '真实请求通过；保存后使用此配置。' : '诊断未通过；输入内容已保留，请按以下原因修正。';
    const current = document.getElementById('custom-provider-current');
    if (current) { current.className = 'chip ' + (report.ok ? 'green' : 'outline'); current.textContent = report.ok ? '已验证，待保存' : '诊断失败'; }
  } catch (error) {
    if (session === state.customProviderSession && panel.isConnected && fingerprint === customProviderFingerprint()) {
      hint.textContent = '诊断失败：' + documentFailureReason(error);
    }
  } finally { if (button?.isConnected) button.disabled = false; }
}

function workflowRuleRows(rules) {
  return rules.map(r => `
    <div class="workflow-rule">
      <span class="wr-icon">${icon(r.icon, 12)}</span>
      <div>
        <div class="wr-title">${esc(r.title)}</div>
        <div class="wr-text">${esc(r.text)}</div>
      </div>
    </div>
  `).join('');
}

function updateWorkflowChrome() {
  const list = document.getElementById('workflow-rules');
  if (list) list.innerHTML = workflowRuleRows(DB.workflow.rules);
  const version = document.getElementById('workflow-version');
  if (version) version.textContent = `v${DB.workflow.version} · ${DB.workflow.updated}`;
  try { storageSet('jw-workflow', JSON.stringify(DB.workflow)); } catch (e) { /* ignore */ }
}

function parseWorkflow() {
  const ta = document.getElementById('workflow-input');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) {
    showToast('先写一句你的工作流，再解析');
    return;
  }

  const rules = [];
  const add = (iconName, title, ruleText) => {
    if (!rules.some(r => r.title === title)) rules.push({ icon: iconName, title, text: ruleText });
  };

  if (/飞书|钉钉|企业微信|企微/.test(text)) add('message', '来源', '聊天工具里的承诺先进入收件箱，不直接改项目');
  if (/老板|领导|上级/.test(text)) add('user', '触发', '老板/领导消息 → 标记高优先级，进入待确认');
  if (/星火|项目/.test(text)) add('folder', '归属', '命中项目别名 → 自动归属；不确定时给候选');
  if (/截止|ddl|DDL|时间/.test(text)) add('clock', '截止', '按原话解析；模糊时追问一次，不猜');
  if (/排不下|插单|影响|冲突|接不接/.test(text)) add('zap', '冲突', '今日排不下 → 先展示插单影响与取舍');
  if (/每天|09:30|9:30|提醒|简报/.test(text)) add('bell', '提醒', '每天 09:30 推送今日必做 + 等待墙');
  if (/会议|行动项/.test(text)) add('calendar', '会议', '会议结束 10 分钟内提取行动项，必须有负责人和截止');
  if (/日报|周报/.test(text)) add('file', '输出', '按事实生成日报/周报，AI 只写叙述');
  if (!rules.length) add('lightbulb', '自定义', '已记录描述；建议补充触发条件、归属规则和提醒时间');

  DB.workflow.text = text;
  DB.workflow.rules = rules;
  DB.workflow.version += 1;
  DB.workflow.updated = '刚刚';
  updateWorkflowChrome();
  showToast(`已提取 ${rules.length} 条规划草稿`);
}

function saveWorkflow() {
  const ta = document.getElementById('workflow-input');
  if (!ta) return;
  DB.workflow.text = ta.value.trim();
  DB.workflow.updated = '刚刚';
  updateWorkflowChrome();
  showToast('工作流规划已保存，自动执行尚未接入');
}

const workflowTemplates = {
  boss: '老板在飞书派活时，先判断是不是星火项目；截止时间按老板原话算。如果今天排不下，先给我看会挤掉什么，再决定接不接。每天 9:30 把今日必做和等待墙发给我。',
  meeting: '开完会 10 分钟内，把行动项提取到收件箱；每条必须有负责人和截止时间。没有负责人的，归到我名下并标记待确认。',
  client: '客户邮件进来先判断项目；涉及承诺的交期先做产能校验。超过 2h 的任务自动拆成 3 个子任务，并在日报里单独列出。'
};

function applyWorkflowTemplate(key) {
  const ta = document.getElementById('workflow-input');
  if (!ta || !workflowTemplates[key]) return;
  ta.value = workflowTemplates[key];
  ta.focus();
  showToast('已插入示例，可继续改成你的说法');
}

function openCapture(projectId = null) {
  state.captureProjectId = projectById(projectId)?.id || null;
  state.captureDraft = null;
  const sample = '老板说：星火下周要给客户演示，你把这周的联调问题整理一下，周三前发我，顺便把演示环境也准备下。';
  const sources = ['飞书', '邮件', '会议', '自己'];
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="快速捕获">
        <div class="modal-head">
          <div class="ai-orb">${icon('sparkles', 16)}</div>
          <div>
            <h2>快速捕获</h2>
            <p class="sub">粘贴老板原话、会议纪要或邮件。AI 只出草稿，你确认后才进项目。</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>

        <div class="modal-body">
          <div class="capture-source">
            ${sources.map(s => `<button class="chip ${state.captureSource === s ? 'on' : ''}" data-action="capture-source" data-source="${s}">${s}</button>`).join('')}
            <span class="chip outline">${icon('lock', 11)} 本地存储</span>
            <button class="chip accent" data-action="nav" data-view="data">${icon('sparkles', 11)} 我的工作流 v${DB.workflow.version}</button>
          </div>

          <div class="capture-area">
            <textarea id="capture-text" placeholder="${esc(sample)}"></textarea>
            <div class="capture-hint">
              <span>原文会永久保留 · 可随时回溯</span>
              <span>Ctrl + Enter 解析</span>
            </div>
          </div>

          <div id="capture-result"></div>
        </div>

        <div class="modal-foot">
          <div class="left">
            <span class="chip">本地规则</span>
            <span class="tiny muted">待确认</span>
          </div>
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-primary" id="parse-btn" data-action="parse">${icon('sparkles', 13)} 解析</button>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => {
    const ta = document.getElementById('capture-text');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 60);
}

function deriveCaptureTitle(text) {
  const clean = text.replace(/^(老板说|王总说|张经理说|客户说|领导说)[：:，,\s]*/, '').trim();
  if (/联调问题/.test(clean)) return '整理联调问题并发给王总';
  if (/竞品分析/.test(clean)) return '输出竞品分析结论';
  if (/灰度/.test(clean)) return '评估灰度名单扩大影响';
  if (/演示环境/.test(clean)) return '准备客户演示环境';
  const first = clean.split(/[。！？!?；;]/)[0];
  const clause = first.split(/[，,]/)[0];
  return clause.length > 26 ? clause.slice(0, 26) + '…' : clause;
}

function parseCapture() {
  const ta = document.getElementById('capture-text');
  const result = document.getElementById('capture-result');
  const btn = document.getElementById('parse-btn');
  if (!ta || !result || !btn) return;

  const text = ta.value.trim();
  if (!text) { showToast('先输入需要记录的工作内容'); return; }
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 正在解析…`;

  setTimeout(() => {
    if (!result.isConnected) return;
    const pid = state.captureProjectId || matchProjectByText(text, false)?.id || null;
    const title = deriveCaptureTitle(text);
    const explicitDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const date = explicitDate ? explicitDate[1]
      : /明天/.test(text) ? addDaysISO(DB.meta.today, 1)
      : /后天/.test(text) ? addDaysISO(DB.meta.today, 2) : DB.meta.today;
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h\b)/i);
    const estimate = hours ? Number(hours[1]) : 1;
    state.captureDraft = { raw: text, source: state.captureSource, title, project: pid, date, estimate };

    result.innerHTML = `
      <div class="parse-result">
        <div class="parse-result-head">${icon('file', 12)} 待确认任务</div>
        <div class="form-grid" style="padding:16px">
          <div class="field full"><label for="capture-title">任务标题</label>
            <input class="input" id="capture-title" value="${esc(title)}"></div>
          <div class="field"><label for="capture-project">项目</label>
            <select class="select" id="capture-project">
              <option value="">未归属</option>
              ${DB.projects.map(project => `<option value="${project.id}" ${project.id === pid ? 'selected' : ''}>${esc(project.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="capture-date">安排日期</label>
            <input class="input" id="capture-date" type="date" value="${date}"></div>
          <div class="field"><label for="capture-estimate">预计时长（小时）</label>
            <input class="input" id="capture-estimate" type="number" min="0.1" max="1000" step="0.1" value="${estimate}"></div>
          <div class="field"><label for="capture-priority">优先级</label>
            <select class="select" id="capture-priority">
              <option>P0</option><option selected>P1</option><option>P2</option><option>P3</option>
            </select></div>
        </div>
        <div class="parse-result-foot">
          ${icon('shield', 11)}
          <span>确认后保存任务与原文</span>
          <button class="btn btn-primary btn-sm" data-action="confirm-capture">${icon('check', 12)} 确认保存</button>
        </div>
      </div>
    `;

    btn.disabled = false;
    btn.innerHTML = `${icon('sparkles', 13)} 重新解析`;
    state.captureParsed = true;
  }, 720);
}

function openCommand() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal command-modal" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="command-input-wrap">
          ${icon('search', 16)}
          <input class="command-input" id="command-input" placeholder="搜索任务、项目、操作…" autocomplete="off">
          <span class="kbd">Esc</span>
        </div>
        <div class="command-list" id="command-list">
          <div class="command-group-label">跳转</div>
          <button class="command-item" data-action="nav" data-view="today">${icon('sun', 15)} 今日 <span class="ci-sub">T</span></button>
          <button class="command-item" data-action="nav" data-view="chat">${icon('message', 15)} 跟${esc(assistantName())}对话 <span class="ci-sub">AI</span></button>
          <button class="command-item" data-action="nav" data-view="inbox">${icon('inbox', 15)} 收件箱 <span class="ci-sub">I</span></button>
          <button class="command-item" data-action="nav" data-view="projects">${icon('layout', 15)} 项目组合 <span class="ci-sub">P</span></button>
          <button class="command-item" data-action="nav" data-view="reports">${icon('file', 15)} 报表 <span class="ci-sub">R</span></button>
          <button class="command-item" data-action="nav" data-view="profile">${icon('user', 15)} 工作方式画像</button>
          <button class="command-item" data-action="nav" data-view="data">${icon('database', 15)} 数据与集成</button>

          <div class="command-group-label">操作</div>
          <button class="command-item" data-action="capture">${icon('plus', 15)} 快速捕获 <span class="ci-sub">Ctrl Space</span></button>
          <button class="command-item" data-action="impact">${icon('zap', 15)} 项目影响</button>
          <button class="command-item" data-action="profile-settings">${icon('settings', 15)} 设置</button>
          <button class="command-item" data-action="command-weekly">${icon('sparkles', 15)} 生成周报</button>
          <button class="command-item" data-action="new-project">${icon('folder', 15)} 新建项目</button>

          <div class="command-group-label">项目</div>
          ${DB.projects.slice(0, 4).map(p => `<button class="command-item" data-action="project" data-id="${p.id}">${icon('folder', 15)} ${esc(p.name)} <span class="ci-sub">${p.progress}%</span></button>`).join('')}
          <div class="command-group-label">任务</div>
          ${allWorkbenchTasks().map(t => `<button class="command-item" data-action="task-edit" data-id="${esc(t.id)}">${icon('check', 15)} ${esc(t.title)}</button>`).join('')}
          <div class="command-group-label">文档</div>
          ${DB.documents.map(d => `<button class="command-item" data-action="document-open" data-id="${esc(d.id)}">${icon('file', 15)} ${esc(d.title)}</button>`).join('')}
        </div>
        <div class="command-foot">
          <span class="k">↵ 打开</span>
          <span class="k">Esc 关闭</span>
          <span style="margin-left:auto">${esc(assistantName())} · 本地优先</span>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => {
    const input = document.getElementById('command-input');
    if (input) input.focus();
  }, 40);
}

function filterCommand(query) {
  const q = query.trim().toLowerCase();
  const list = document.getElementById('command-list');
  if (!list) return;
  list.querySelectorAll('.command-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  list.querySelectorAll('.command-group-label').forEach(label => {
    let next = label.nextElementSibling;
    let any = false;
    while (next && !next.classList.contains('command-group-label')) {
      if (next.classList.contains('command-item') && next.style.display !== 'none') any = true;
      next = next.nextElementSibling;
    }
    label.style.display = any ? '' : 'none';
  });
}

function openImpact() {
  state.pendingImpact = null;
  const tasks = tasksOnDate(DB.meta.today).filter(t => !t.done);
  localModal('插单影响分析', `<p class="small muted">当前承诺 ${DB.capacity.committed}h / 可用 ${DB.capacity.available}h</p>
    <div class="form-grid">${inputField('impact-title', '新增事项', '')}
    ${inputField('impact-hours', '预计小时', '1', 'number', 'min="0.1" max="1000" step="0.1"')}
    ${selectField('impact-mode', '安排方案', [['today', '加入今日'], ['defer', '将一项今日任务移至明天'], ['nextweek', '安排到下周一']], 'today')}
    ${selectField('impact-move', '需要移至明天的任务', tasks.map(t => [t.id, t.title]), tasks[0]?.id)}</div>`,
    '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="impact-preview">预览调整</button>');
}
