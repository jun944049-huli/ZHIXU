/* Router, events and boot */

function renderView() {
  switch (state.view) {
    case 'chat': return renderChat();
    case 'inbox': return renderInbox();
    case 'projects': return renderProjects();
    case 'project': return renderProject();
    case 'reports': return renderReports();
    case 'profile': return renderProfile();
    case 'data': return renderData();
    case 'today':
    default: return renderToday();
  }
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  const sidebar = document.getElementById('sidebar-root');
  const topbar = document.getElementById('topbar-root');
  const view = document.getElementById('view');
  if (!sidebar || !topbar || !view) return;

  sidebar.innerHTML = renderSidebar();
  topbar.innerHTML = renderTopbar();
  view.className = 'view view-enter';
  view.innerHTML = renderView();

  const brand = assistantName();
  const titles = {
    today: '今日 · ' + brand,
    chat: '对话 · ' + brand,
    inbox: '收件箱 · ' + brand,
    projects: '项目 · ' + brand,
    project: '项目详情 · ' + brand,
    reports: '报表 · ' + brand,
    profile: '画像 · ' + brand,
    data: '数据与集成 · ' + brand
  };
  document.title = titles[state.view] || brand;
  scheduleWorkbenchSave();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  try { storageSet('jw-theme', state.theme); } catch (e) { /* ignore */ }
  render();
}

function setTodayDate(iso, range = 'day') {
  state.todayDate = iso || DB.meta.today;
  state.todayRange = range === 'week' ? 'week' : 'day';
  state.todayMenu = false;
  render();
}

function shiftToday(delta) {
  const current = state.todayDate || DB.meta.today;
  if (state.todayRange === 'week') {
    state.todayDate = addDaysISO(startOfWeekISO(current), delta * 7);
    state.todayRange = 'week';
  } else {
    state.todayDate = addDaysISO(current, delta);
    state.todayRange = 'day';
  }
  state.todayMenu = false;
  render();
}

function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'backdrop') {
    if (e.target === el) closeModal();
    return;
  }

  switch (action) {
    case 'new-project':
      openProjectEditor();
      break;
    case 'edit-project':
      openProjectEditor(el.dataset.id);
      break;
    case 'save-project':
      saveProject();
      break;
    case 'delete-project':
      openProjectDelete(el.dataset.id);
      break;
    case 'confirm-delete-project':
      deleteProject();
      break;
    case 'project-task':
      openCapture(el.dataset.id);
      break;
    case 'today-prev':
      shiftToday(-1);
      break;
    case 'today-next':
      shiftToday(1);
      break;
    case 'today-toggle':
      state.todayMenu = !state.todayMenu;
      render();
      break;
    case 'today-close':
      state.todayMenu = false;
      render();
      break;
    case 'today-today':
      setTodayDate(DB.meta.today, 'day');
      break;
    case 'today-option':
      setTodayDate(el.dataset.date, el.dataset.range || 'day');
      break;
    case 'nav':
      state.view = el.dataset.view;
      closeModal();
      render();
      if (state.view === 'chat') scrollChatToBottom();
      break;
    case 'project':
      state.view = 'project';
      state.projectId = el.dataset.id;
      state.projectTab = 'overview';
      closeModal();
      render();
      break;
    case 'project-tab':
      state.projectTab = el.dataset.tab;
      render();
      break;
    case 'chat-open-notes':
      state.view = 'project';
      state.projectId = el.dataset.id;
      state.projectTab = 'notes';
      closeModal();
      render();
      break;
    case 'chat-with-project':
      state.view = 'chat';
      state.chatContext = el.dataset.id;
      closeModal();
      render();
      scrollChatToBottom();
      break;
    case 'report':
      state.report = el.dataset.report;
      render();
      break;
    case 'copy-report-link': {
      const input = document.getElementById('report-share-link');
      const link = input ? input.value : '';
      if (!link) break;
      let handled = false;
      const finish = (msg) => {
        if (handled) return;
        handled = true;
        showToast(msg);
      };
      const fallback = () => {
        if (input) { input.focus(); input.select(); }
        finish('已选中链接，按 Ctrl+C 复制');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link)
          .then(() => finish('报告链接已复制'))
          .catch(fallback);
        setTimeout(() => { if (!handled) fallback(); }, 600);
      } else {
        fallback();
      }
      break;
    }
    case 'inbox':
      state.inboxId = el.dataset.id;
      render();
      break;
    case 'fields-tab':
      state.fieldsTab = el.dataset.tab;
      render();
      break;
    case 'capture':
      openCapture();
      break;
    case 'command':
      openCommand();
      break;
    case 'impact':
      openImpact();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'theme':
      toggleTheme();
      break;
    case 'profile-settings':
      openProfileSettings();
      break;
    case 'save-profile':
      saveProfile();
      break;
    case 'test-deepseek':
      testDeepSeek();
      break;
    case 'test-custom-provider':
      testCustomProvider();
      break;
    case 'avatar-color':
      setAvatarColor(el.dataset.color);
      break;
    case 'parse-workflow':
      parseWorkflow();
      break;
    case 'save-workflow':
      saveWorkflow();
      break;
    case 'workflow-template':
      applyWorkflowTemplate(el.dataset.template);
      break;
    case 'parse':
      parseCapture();
      break;
    case 'capture-source':
      state.captureSource = el.dataset.source;
      document.querySelectorAll('.capture-source .chip[data-source]').forEach(chip => {
        chip.classList.toggle('on', chip.dataset.source === state.captureSource);
      });
      break;
    case 'confirm-capture':
      confirmCapture();
      break;
    case 'confirm-inbox':
      confirmInbox();
      break;
    case 'check':
      toggleTask(el.closest('.task-row')?.dataset.task);
      break;
    case 'impact-option':
      state.impactOption = el.dataset.opt;
      openImpact();
      break;
    case 'apply-impact':
      closeModal();
      showToast('已按方案调整，并生成沟通话术');
      break;
    case 'toast':
      showToast(el.dataset.msg || '演示操作');
      break;
    case 'chat-send':
      sendChat();
      break;
    case 'chat-apply':
      applyChatAction(el.dataset.mode || '', el.dataset.id);
      break;
    case 'chat-cancel':
      cancelChat(el.dataset.id);
      break;
    case 'chat-suggestion':
      fillChatInput(el.dataset.text || el.textContent.trim());
      break;
    case 'open-polish':
      openPolish();
      break;
    case 'polish-tone':
      setPolishTone(el.dataset.tone);
      break;
    case 'polish-apply':
      applyPolish();
      break;
    case 'polish-copy':
      copyPolish();
      break;
    case 'polish-reset':
      resetPolish();
      break;
    case 'chat-shortcuts':
      openChatShortcuts();
      break;
    case 'chat-shortcut-add':
      addChatShortcut();
      break;
    case 'chat-shortcut-remove':
      removeChatShortcut(el.dataset.id);
      break;
    case 'chat-shortcut-reset':
      resetChatShortcuts();
      break;
    case 'chat-shortcut-save':
      saveChatShortcuts();
      break;
    default:
      break;
  }
}

function handleInput(e) {
  if (e.target.id === 'command-input') {
    filterCommand(e.target.value);
  }

  if (e.target.id === 'profile-name') {
    const name = e.target.value.trim() || '未命名';
    const preview = document.getElementById('profile-preview-name');
    if (preview) preview.textContent = name;
  }

  if (e.target.id === 'profile-role') {
    const role = e.target.value.trim() || '未设置角色';
    const preview = document.getElementById('profile-preview-role');
    if (preview) preview.textContent = role;
  }

  if (e.target.id === 'profile-initials') {
    const av = document.getElementById('profile-avatar');
    const name = document.getElementById('profile-name');
    if (av) av.textContent = e.target.value.trim() || deriveInitials(name ? name.value : '');
  }

  if (e.target.id === 'polish-original') {
    state.polishText = e.target.value;
    const count = document.getElementById('polish-original-count');
    if (count) count.textContent = state.polishText.length;
    refreshPolishPreview();
  }

  if (['custom-provider-base', 'custom-provider-model', 'custom-provider-name'].includes(e.target.id)) {
    updateCustomProviderDetection();
  }
}

function handleKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommand();
    return;
  }

  if (mod && e.code === 'Space') {
    e.preventDefault();
    openCapture();
    return;
  }

  if (e.key === 'Escape') {
    if (state.todayMenu) {
      state.todayMenu = false;
      render();
      return;
    }
    closeModal();
    return;
  }

  if (mod && e.key === 'Enter' && document.getElementById('capture-text')) {
    e.preventDefault();
    parseCapture();
    return;
  }

  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    if (e.isComposing) return;
    e.preventDefault();
    sendChat();
    return;
  }

  if (e.key === 'Enter' && e.target.id === 'command-input') {
    e.preventDefault();
    const first = Array.from(document.querySelectorAll('#command-list .command-item'))
      .find(item => item.style.display !== 'none');
    if (first) first.click();
  }
}

function handleChange(e) {
  if (e.target.id === 'today-date-input' && e.target.value) {
    setTodayDate(e.target.value, 'day');
    return;
  }
  if (e.target.id === 'report-date' && e.target.value) {
    state.reportDate = e.target.value;
    render();
    return;
  }
  if (e.target.id === 'chat-model') {
    state.chatModel = e.target.value;
    const custom = (DB.settings && DB.settings.customProvider) || {};
    if (state.chatModel === 'DeepSeek') {
      DB.settings.aiProvider = deepseekKey() ? 'deepseek' : 'local';
    } else if (custom.name && state.chatModel === custom.name) {
      DB.settings.aiProvider = 'custom';
    } else {
      DB.settings.aiProvider = 'local';
    }
    try { storageSet('jw-chat-model', state.chatModel); } catch (err) { /* ignore */ }
    saveSettings();
    refreshAIProviderUI();
  }
  if (e.target.id === 'chat-context') state.chatContext = e.target.value;
}

function loadLocalOverrides() {
  try {
    state.theme = storageGet('jw-theme') || state.theme;
    const profile = JSON.parse(storageGet('jw-profile') || 'null');
    if (profile && profile.name) {
      const oldName = DB.user.name;
      Object.assign(DB.user, profile);
      DB.user.workspace = DB.user.name + '的工作台';
      DB.projects.forEach(p => {
        if (p.owner === oldName) p.owner = DB.user.name;
      });
      Object.values(DB.projectDetails || {}).forEach(d => {
        (d.stakeholders || []).forEach(s => {
          if (s.name === oldName) s.name = DB.user.name;
        });
      });
    }
    const settings = JSON.parse(storageGet('jw-settings') || 'null');
    if (settings && typeof settings === 'object') {
      DB.settings = Object.assign({}, DB.settings, settings);
      DB.settings.assistantName = String(DB.settings.assistantName || '').trim().slice(0, 12) || '小鱼';
    }
    const workflow = JSON.parse(storageGet('jw-workflow') || 'null');
    if (workflow && workflow.text) Object.assign(DB.workflow, workflow);
    const projectNotes = JSON.parse(storageGet('jw-project-notes') || 'null');
    if (projectNotes && typeof projectNotes === 'object') {
      DB.projectNotes = DB.projectNotes || {};
      Object.keys(projectNotes).forEach(id => {
        if (Array.isArray(projectNotes[id])) DB.projectNotes[id] = projectNotes[id];
      });
    }
    const chatShortcuts = JSON.parse(storageGet('jw-chat-shortcuts') || 'null');
    if (Array.isArray(chatShortcuts)) state.chatShortcuts = chatShortcuts;
    const chatHistory = JSON.parse(storageGet('jw-chat-history') || 'null');
    if (Array.isArray(chatHistory) && chatHistory.length) state.chatMessages = chatHistory;
    const chatModel = storageGet('jw-chat-model');
    if (chatModel) state.chatModel = chatModel;
    const activeProvider = aiProviderConfig();
    if (activeProvider.id === 'custom') state.chatModel = activeProvider.name;
  } catch (e) { /* ignore */ }
}

async function boot() {
  try {
    await initializeWorkbenchStorage();
  } catch (error) {
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = '<div class="page-head"><div><h1>工作数据未能载入</h1><p class="sub"></p></div></div>';
      view.querySelector('.sub').textContent = error.message || '请重启应用后再试。';
    }
    return;
  }
  state.reportDate = DB.meta.today;
  loadLocalOverrides();
  updateTaskCapacity();
  try {
    const params = new URLSearchParams(location.search);
    const report = params.get('report');
    if (report && ['daily', 'weekly', 'monthly', 'project', 'risk', 'requirements'].includes(report)) {
      state.view = 'reports';
      state.report = report;
    }
    const date = params.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) state.reportDate = date;
  } catch (e) { /* ignore */ }
  document.documentElement.dataset.theme = state.theme;
  render();
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('focusin', event => {
    if (event.target.id === 'report-share-link') event.target.select();
  });

  setTimeout(() => {
    if (!window.xiaoyuDesktop) showToast('工作数据已启用本地保存');
  }, 900);
}

boot();
