/* Dedicated AI dialogue page */

function ensureChat() {
  if (!state.chatMessages) {
    state.chatMessages = [{ role: 'assistant', time: '现在', model: '系统',
      text: hasAIProvider() ? '今天有什么需要一起处理？' : '今天想先安排哪件事？',
      quick: hasAIProvider() ? [] : [{ label: '连接模型', action: 'model-settings' }] }];
  }
}

function saveChatHistory() {
  try {
    storageSet('jw-chat-history', JSON.stringify((state.chatMessages || []).slice(-60)));
  } catch (e) { /* ignore */ }
}

function defaultChatShortcuts() {
  return [
    { id: 's-progress', label: '更新进展', text: '我想更新项目进展：' },
    { id: 's-task', label: '拆解任务', text: '请帮我把以下内容拆解成任务：' },
    { id: 's-report', label: '本周总结', text: '基于本周事实生成周报，重点写风险和下周计划' }
  ];
}

function ensureChatShortcuts() {
  if (!Array.isArray(state.chatShortcuts)) state.chatShortcuts = defaultChatShortcuts();
}

function scrollChatToBottom() {
  const thread = document.getElementById('chat-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function matchProjectByText(text, includeContext = true) {
  const named = DB.projects.find(p => text.includes(p.name));
  if (named) return named;
  const rules = [
    { id: 'p1', words: ['星火', '联调', '演示'] },
    { id: 'p2', words: ['客户成功', '灰度', '迁移'] },
    { id: 'p3', words: ['品牌', '主视觉', '官网'] },
    { id: 'p4', words: ['内部工具', 'SSO', '工具链'] },
    { id: 'p5', words: ['招聘', 'JD', '面试'] },
    { id: 'p6', words: ['数据治理', '口径', '指标'] }
  ];
  for (const r of rules) {
    if (projectById(r.id) && r.words.some(w => text.includes(w))) return projectById(r.id);
  }
  for (const [id, detail] of Object.entries(DB.projectDetails || {})) {
    if ((detail.stakeholders || []).some(s => s.name && text.includes(s.name))) {
      return projectById(id);
    }
  }
  if (includeContext && state.chatContext !== 'auto') return projectById(state.chatContext);
  return null;
}

function renderChatActionCard(card) {
  if (!card.id) card.id = newRecordId('action');
  const status = card.status || 'pending';
  const done = status === 'done';
  const cancelled = status === 'cancelled';
  return `
    <div class="action-card ${done ? 'done' : ''} ${cancelled ? 'cancelled' : ''}">
      <div class="action-card-head">
        ${icon(done ? 'check' : 'sparkles', 12)}
        <span>${esc(card.title)}</span>
        ${done ? '<span class="chip green" style="margin-left:auto">已执行</span>' : cancelled ? '<span class="chip" style="margin-left:auto">已取消</span>' : ''}
      </div>
      <div class="action-items">
        ${card.items.map(it => `
          <div class="action-item">
            <span class="ai-check">${icon(done ? 'check' : 'arrowRight', 10)}</span>
            <span><b>${esc(it.label)}</b><span>${esc(it.value)}</span></span>
          </div>
        `).join('')}
      </div>
      ${status === 'pending' ? `
        <div class="action-foot">
          <button class="btn btn-primary btn-sm" data-action="chat-apply" data-id="${card.id}">${icon('check', 12)} 确认执行</button>
          ${card.type === 'progress' && !card.modelAction ? `<button class="btn btn-sm" data-action="chat-apply" data-id="${card.id}" data-mode="progress">只更新进度</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-action="chat-cancel" data-id="${card.id}">取消</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderChatQuick(items) {
  return `<div class="chat-quick">${items.map(q => {
    if (q.action === 'chat-suggestion') {
      return `<button class="chip" data-action="chat-suggestion" data-text="${esc(q.text)}">${esc(q.label)}</button>`;
    }
    if (q.action) {
      return `<button class="chip" data-action="${q.action}">${esc(q.label)}</button>`;
    }
    return `<button class="chip" data-action="nav" data-view="${q.view}">${esc(q.label)}</button>`;
  }).join('')}</div>`;
}

function renderChatShortcuts() {
  ensureChatShortcuts();
  const chips = state.chatShortcuts
    .map(s => `<button class="chip" data-action="chat-suggestion" data-text="${esc(s.text)}">${esc(s.label)}</button>`)
    .join('');

  return `
    <div class="chat-suggestions-wrap">
      <div class="chat-suggestions">${chips}</div>
      <button class="icon-btn sm shortcut-add" data-action="chat-shortcuts" title="管理快捷指令" aria-label="管理快捷指令">${icon('more', 16)}</button>
    </div>
  `;
}

function renderChatMessage(m) {
  const isUser = m.role === 'user';
  const avatar = isUser
    ? `<span class="chat-avatar user" style="background:${DB.user.color}">${esc(DB.user.initials)}</span>`
    : `<span class="chat-avatar ai">${brandImage()}</span>`;
  const model = String(m.model || '').trim() || '来源未记录';
  const meta = isUser ? `你 · ${esc(m.time)}` :
    `${esc(assistantName())} · <span class="chat-message-model" title="${esc(model)}">${esc(model)}</span> · ${esc(m.time)}`;
  const text = isUser
    ? String(m.text || '')
    : ZhixuChatFormatting.display(String(m.text || '')).replace(/^早上好，[^。]+。/, `早上好，${DB.user.name}。`);
  return `
    <div class="chat-msg ${isUser ? 'user' : 'assistant'}">
      ${avatar}
      <div class="chat-msg-body">
        <div class="chat-bubble">${esc(text).replace(/\n/g, '<br>')}
          ${m.suggestions ? renderChatQuick(m.suggestions) : ''}
        </div>
        ${m.loggedNote ? `
          <div class="note-logged">
            ${icon('table', 12)}
            <span>已自动润色并写入 <b>${esc(m.loggedNote.projectName)}</b> 项目表</span>
            <button class="chip" data-action="chat-open-notes" data-id="${esc(m.loggedNote.projectId)}">查看项目表</button>
            <div class="note-logged-text">${esc(m.loggedNote.text)}</div>
          </div>
        ` : ''}
        ${m.actionCard ? m.actionCard.type === 'work_update' && m.actionCard.status === 'done' ?
          `<details class="chat-work-details"><summary>查看同步详情</summary>${renderChatActionCard(m.actionCard)}</details>` :
          renderChatActionCard(m.actionCard) : ''}
        ${m.retryOf ? `<button class="btn btn-sm mt-8" data-action="chat-retry" data-id="${esc(m.retryOf)}">${icon('refresh', 12)} 重试模型请求</button>` : ''}
        ${m.documentId && documentById(m.documentId) ? `<div class="chat-document-result">
          <ul>${(m.documentTasks || []).map(task => `<li>${esc(task.title)}</li>`).join('')}</ul>
          <button class="btn btn-sm" data-action="document-chat-details" data-id="${esc(m.documentId)}">${icon('file', 12)} 详细 ${icon('arrowRight', 12)}</button>
        </div>` : ''}
        ${m.quick ? renderChatQuick(m.quick) : ''}
        <div class="chat-meta">${meta}</div>
      </div>
    </div>
  `;
}

function renderChatLoading() {
  return `
    <div class="chat-msg assistant">
      <span class="chat-avatar ai">${brandImage()}</span>
      <div class="chat-msg-body">
        <div class="chat-bubble chat-loading"><i></i><i></i><i></i></div>
        <div class="chat-meta">正在使用 ${esc(state.chatRequestModel || chatModelLabel())}…</div>
      </div>
    </div>
  `;
}

function renderChat() {
  ensureChat();
  ensureChatShortcuts();
  const contexts = [{ id: 'auto', name: '自动匹配' }].concat(DB.projects.map(p => ({ id: p.id, name: p.name })));
  return `
    <div class="page-head chat-page-head">
      <div>
        <h1>对话</h1>
      </div>
      <div class="head-actions">
        <button class="btn btn-sm" data-action="workspace-toggle" aria-pressed="${workspaceState.open}">${icon('folder', 14)} 工作区</button>
        <button class="btn btn-sm btn-ghost" data-action="chat-details" aria-pressed="${state.chatDetails}">${icon('layers', 14)} 参考内容</button>
      </div>
    </div>

    <div class="chat-layout ${state.chatDetails ? 'with-context' : ''} ${workspaceState.open ? 'with-workspace' : ''}">
      <section class="chat-main" aria-label="对话消息">
        <div class="chat-thread" id="chat-thread">
          ${state.chatMessages.map(renderChatMessage).join('')}
          ${state.chatSending ? renderChatLoading() : ''}
        </div>

        <div class="chat-composer">
          ${renderChatShortcuts()}

          <div class="composer-box">
            <textarea id="chat-input" rows="2" maxlength="20000" aria-label="消息" placeholder="有什么需要一起处理？">${esc(state.chatDraft || '')}</textarea>
            <div class="composer-bar">
              <button class="icon-btn sm" data-action="chat-attachment" title="上传附件" aria-label="上传附件">${icon('plus', 14)}</button>
              <button class="icon-btn sm" data-action="document-library" title="附件记录与待确认项目" aria-label="附件记录与待确认项目">${icon('file', 14)}</button>
              <select class="chat-select" id="chat-context" aria-label="参考范围">
                ${contexts.map(c => `<option value="${c.id}" ${state.chatContext === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
              <button class="icon-btn sm composer-tool" data-action="open-polish" title="润色" aria-label="润色">${icon('sparkles', 15)}</button>
              <span class="composer-spacer"></span>
              <span class="small muted chat-active-model" title="${esc(chatModelLabel())}">${esc(chatModelLabel())}</span>
              <button class="send-btn" data-action="chat-send" aria-label="发送" ${state.chatSending ? 'disabled' : ''}>${icon('arrowUp', 16)}</button>
            </div>
          </div>
        </div>
      </section>

      ${workspaceState.open ? renderWorkspace() : ''}
      ${state.chatDetails ? `<aside class="chat-rail" aria-label="参考内容">
        <section>
          <div class="panel-head"><h3>参考内容</h3><button class="icon-btn sm" data-action="chat-details" title="关闭参考内容" aria-label="关闭参考内容">${icon('x', 14)}</button></div>
          <div class="panel-body">
            <div class="chat-context-list">
              <div><span>范围</span><b>${state.chatContext === 'auto' ? '自动匹配' : esc(projectById(state.chatContext)?.name || '未选择')}</b></div>
              <div><span>项目</span><b>${DB.projects.length}</b></div>
              <div><span>任务</span><b>${allWorkbenchTasks().length}</b></div>
              <div><span>今日剩余</span><b>${Math.max(0, DB.capacity.available - DB.capacity.committed).toFixed(1)}h</b></div>
            </div>
            <button class="btn btn-block mt-12" data-action="document-library">${icon('file', 14)} 查看附件</button>
          </div>
        </section>
      </aside>` : ''}
    </div>
  `;
}

function deriveChatTaskTitle(text) {
  if (/竞品分析/.test(text)) return '输出竞品分析结论';
  if (/联调/.test(text)) return '整理联调问题';
  if (/邮件/.test(text)) return '整理客户邮件行动项';
  if (/周报/.test(text)) return '生成周报';
  const clean = text.replace(/^(帮我|请|把|将)\s*/, '').trim();
  return clean.length > 24 ? clean.slice(0, 24) + '…' : clean;
}

function polishProjectNote(text) {
  let t = String(text || '').trim()
    .replace(/\s+/g, ' ')
    .replace(/^(嗯|额|那个|就是)[，,\s]*/g, '')
    .replace(/那个|就是|然后呢|怎么说呢|其实|基本上|大概/g, '')
    .replace(/差不多/g, '约')
    .replace(/跟/g, '与')
    .replace(/还是没/g, '仍未')
    .replace(/得(?=准备|给|去|看|做|先|等|把|在)/g, '需')
    .replace(/挺/g, '较')
    .replace(/翻车/g, '出现故障')
    .replace(/免得/g, '避免')
    .replace(/搞定/g, '完成')
    .replace(/会开完了/g, '会议已结束')
    .replace(/开完了/g, '已结束')
    .replace(/提了/g, '提取')
    .replace(/说一下/g, '同步')
    .replace(/看一下/g, '查看')
    .replace(/补一下/g, '补充')
    .replace(/数据那边/g, '数据团队')
    .replace(/(^|[，。；;])\s*等/g, '$1等待')
    .replace(/同步了/g, '同步')
    .replace(/了(?=[，。；;]|$)/g, '')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/。\s*。/g, '。')
    .replace(/^[，,。\s]+/, '')
    .trim();

  if (t && !/[。！？]$/.test(t)) t += '。';
  return t;
}

function refineProjectNoteWithAI(note, raw, projectId, activity) {
  const provider = aiProviderConfig();
  if (provider.id === 'local') return;
  requestAIPolish(raw, '简洁', provider)
    .then(result => {
      if (!result || !note || !DB.projectNotes?.[projectId]?.includes(note)) return;
      note.text = result;
      saveProjectNotes();
      if (activity) activity.text = '新增项目记录：' + (result.length > 36 ? result.slice(0, 36) + '…' : result);
      if (state.view === 'project' && state.projectId === projectId && state.projectTab === 'notes') render();
      return persistWorkbench();
    })
    .catch(() => { /* keep the local polish */ });
}

function autoLogProjectNote(text, projectId) {
  const p = projectId ? projectById(projectId) : matchProjectByText(text);
  if (!p) return null;
  const raw = String(text || '').trim();
  if (!raw) return null;

  const polished = polishProjectNote(raw) || raw;
  const note = appendProjectNote(p.id, polished, { raw, source: '对话' });

  if (!DB.projectDetails[p.id]) DB.projectDetails[p.id] = detailForProject(p);
  const activity = {
    time: noteTimestamp(note),
    text: '新增项目记录：' + (polished.length > 36 ? polished.slice(0, 36) + '…' : polished),
    tone: 'accent'
  };
  DB.projectDetails[p.id].activity.unshift(activity);
  saveProjectNotes();
  refineProjectNoteWithAI(note, raw, p.id, activity);
  return { project: p, note };
}

function buildChatReply(text) {
  const p = matchProjectByText(text);
  const progressMatch = text.match(/(\d{1,3})\s*%/);
  const progress = progressMatch ? Math.max(0, Math.min(100, parseInt(progressMatch[1], 10))) : null;
  const wantsRisk = /风险|阻塞|测试库|延迟/.test(text);
  const wantsProgress = /进展|进度|完成|更新/.test(text);
  const wantsTask = /任务|派活|安排|拆|整理|行动项/.test(text);
  const wantsReport = /周报|日报|报告|汇报/.test(text);
  const wantsCapacity = /接活|排得下|排不下|产能|插单|2\s*小时|2h/.test(text);

  if (wantsReport) {
    return {
      role: 'assistant', time: '现在', model: state.chatModel,
      text: `本机共有 ${allWorkbenchTasks().length} 条任务记录。报表页可按日期汇总日报、周报和月报。`,
      quick: [
        { label: '打开周报预览', view: 'reports' },
        { label: '只看风险', view: 'reports' }
      ]
    };
  }

  if (wantsCapacity) {
    return {
      role: 'assistant', time: '现在', model: state.chatModel,
      text: `今日承诺 ${DB.capacity.committed}h / 可用 ${DB.capacity.available}h。再接 2h 后为 ${formatHours(DB.capacity.committed + 2)}。\n可在插单影响中输入实际事项，预览并确认排期。`,
      quick: [
        { label: '打开插单影响', action: 'impact' },
        { label: '查看今日清单', view: 'today' }
      ]
    };
  }

  if ((wantsProgress || wantsRisk) && !wantsTask) {
    if (!p) {
      return {
        role: 'assistant', time: '现在', model: state.chatModel,
        text: '我暂时没匹配到项目。你指的是哪一个？',
        quick: DB.projects.slice(0, 4).map(proj => ({ label: proj.name, action: 'chat-suggestion', text: proj.name + '：' }))
      };
    }

    if (wantsProgress && progress == null) return {
      role: 'assistant', time: '现在', model: '本地指令', text: `请提供「${p.name}」的明确进度，例如“进度更新到 50%”。`
    };
    const target = progress == null ? p.progress : progress;
    const items = [{ label: '匹配项目', value: p.name }];
    if (wantsProgress) {
      items.push({
        label: '更新进度',
        value: `项目整体进度 · ${p.progress}% → ${target}%`
      });
    }
    if (wantsRisk) {
      items.push({
        label: '更新风险',
        value: p.id === 'p1' ? '测试库开通延迟 · 中 → 高' : '项目风险 · 标记为高'
      });
    }
    return {
      role: 'assistant', time: '现在', model: state.chatModel,
      text: `我匹配到「${p.name}」，准备更新 ${items.length - 1} 项。先确认，再写入。`,
      actionCard: {
        type: wantsProgress ? 'progress' : 'risk',
        status: 'pending',
        title: `准备更新 · ${p.name}`,
        projectId: p.id, raw: text, updateRisk: wantsRisk,
        progress: target,
        items
      }
    };
  }

  if (wantsTask) {
    const title = deriveChatTaskTitle(text);
    const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || (/明天/.test(text)
      ? addDaysISO(DB.meta.today, 1) : /后天/.test(text) ? addDaysISO(DB.meta.today, 2) : DB.meta.today);
    const due = date;
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h\b)/i);
    const estimate = hours ? `${Number(hours[1])}h` : '1h';
    return {
      role: 'assistant', time: '现在', model: state.chatModel,
      text: `已整理为任务草稿，确认后安排到 ${date}。`,
      actionCard: {
        type: 'task',
        status: 'pending',
        title: '准备新建任务',
        projectId: p ? p.id : null,
        taskTitle: title,
        due, date,
        estimate, raw: text,
        items: [
          { label: '匹配项目', value: p ? p.name : '未归属' },
          { label: '任务标题', value: title },
          { label: '截止', value: due },
          { label: '预估', value: estimate },
          { label: '安排日期', value: date }
        ]
      }
    };
  }

  return {
    role: 'assistant', time: '现在', model: state.chatModel,
    text: '我先把它记到收件箱，不直接改任何项目。你可以再告诉我要归到哪个项目。',
    actionCard: {
      type: 'capture',
      status: 'pending',
      title: '收件箱草稿',
      projectId: p ? p.id : null, raw: text,
      items: [
        { label: '匹配项目', value: p ? p.name : '未归属 · 待确认' },
        { label: '原文', value: text.length > 32 ? text.slice(0, 32) + '…' : text },
        { label: '建议', value: '确认后进入收件箱，再决定今天或下周' }
      ]
    }
  };
}

function chatModelLabel() {
  const provider = aiProviderConfig();
  return provider.id === 'local' ? '本地规则' : provider.name + ' · ' + provider.model;
}

function modelChatContext() {
  const selected = state.chatContext !== 'auto' ? projectById(state.chatContext)?.id || null : null;
  const relevant = item => !selected || item.project === selected || item.projectId === selected;
  const taskDates = new Map(allWorkbenchTasks().map(task => [task.id, DB.meta.today]));
  for (const [date, tasks] of Object.entries(DB.taskCalendar || {})) {
    tasks.forEach(task => taskDates.set(task.id, date));
  }
  const tasks = allWorkbenchTasks().filter(relevant).slice(-150).map(task => ({
    id: task.id, title: task.title, projectId: task.project || null, done: !!task.done,
    status: workTaskStatus(task), progress: taskWorkProgress(task),
    due: task.due, date: taskDates.get(task.id), assignee: task.assignee || '', estimate: task.estimate, priority: task.priority,
    details: String(task.details || '').slice(0, 2000),
    notes: taskNotesFor(task).slice(0, 3).map(note => ({ text: String(note.text).slice(0, 600), time: noteTimestamp(note) }))
  }));
  const projects = DB.projects.filter(project => !selected || project.id === selected).slice(0, 100)
    .map(project => ({ id: project.id, name: project.name, progress: project.progress,
      goal: String(project.goal || '').slice(0, 500), owner: project.owner,
      risks: (DB.projectDetails[project.id]?.risks || []).filter(risk => risk.status !== 'closed')
        .slice(0, 10).map(risk => ({ title: risk.title, level: risk.level })) }));
  const milestones = DB.projects.filter(project => !selected || project.id === selected)
    .flatMap(project => projectMilestones(project.id).map(item => ({
      id: item.id, projectId: project.id, name: item.name, status: item.status,
      taskIds: milestoneTaskIds(project.id, item)
    }))).slice(0, 500);
  const documents = DB.documents.filter(doc => !doc.parseError && relevant(doc)).slice(-4).map(doc => ({
    title: doc.title, projectId: doc.projectId, summary: doc.analysis?.summary || '',
    excerpt: String(doc.content || '').slice(0, 8000), excerptOnly: String(doc.content || '').length > 8000
  }));
  const data = { projects, tasks, documents, capacity: DB.capacity,
    workflow: String(DB.workflow.text || '').slice(0, 2000),
    notes: selected ? projectNotesFor(selected).slice(0, 3).map(note => String(note.text).slice(0, 1000)) : [],
    scope: selected || '全部项目的有限摘要；未提供的数据不能推测' };
  let encoded = JSON.stringify(data);
  while (encoded.length > 100000 && data.documents.length) { data.documents.shift(); encoded = JSON.stringify(data); }
  while (encoded.length > 100000 && data.tasks.length) { data.tasks.shift(); encoded = JSON.stringify(data); }
  while (encoded.length > 100000 && data.projects.length) { data.projects.pop(); encoded = JSON.stringify(data); }
  return { today: DB.meta.today, selectedProjectId: selected,
    projects: DB.projects.slice(0, 500).map(project => ({ id: project.id, name: project.name })),
    tasks: tasks.map(({ id, title, projectId, status, progress }) => ({ id, title, projectId, status, progress })),
    milestones, data: encoded };
}

function modelChatCard(action, raw) {
  const project = action.projectId ? projectById(action.projectId) : null;
  if (action.projectId && !project) return null;
  const card = { ...action, id: newRecordId('action'), status: 'pending', raw, modelAction: true, items: [] };
  if (action.type === 'task') Object.assign(card, {
    title: '准备新建任务', taskTitle: action.title, date: action.date || action.due || DB.meta.today,
    estimate: action.estimateHours ? `${action.estimateHours}h` : '待估时',
    items: [{ label: '任务', value: action.title }, { label: '项目', value: project?.name || '未归属' },
      { label: '负责人', value: action.assignee || '待确认' }, { label: '截止日期', value: action.due || '待确认' },
      { label: '工时', value: action.estimateHours ? `${action.estimateHours}h` : '待估时' },
      { label: '安排日期', value: action.date || action.due || DB.meta.today }, { label: '优先级', value: action.priority }]
  });
  if (action.type === 'progress') Object.assign(card, { title: '准备更新项目进度',
    items: [{ label: '项目', value: project.name }, { label: '进度', value: `${project.progress}% → ${action.progress}%` }] });
  if (action.type === 'risk') Object.assign(card, { title: '准备更新风险', riskTitle: action.title, riskLevel: action.level,
    items: [{ label: '项目', value: project.name }, { label: '风险', value: action.title }, { label: '等级', value: action.level }] });
  if (action.type === 'capture') Object.assign(card, { title: '准备保存到收件箱', captureTitle: action.title,
    items: [{ label: '内容', value: action.title }, { label: '项目', value: project?.name || '未归属' }] });
  if (action.type === 'project') Object.assign(card, { title: '准备创建新项目',
    items: [{ label: '名称', value: action.name }, { label: '目标', value: action.goal || '待补充' },
      { label: '负责人', value: action.owner || DB.user.name }] });
  return card;
}

async function sendChat(retryId = '') {
  if (state.chatSending) return;
  ensureChat();
  const ta = document.getElementById('chat-input');
  const previous = retryId ? state.chatMessages.find(message => message.id === retryId && message.role === 'user') : null;
  if (!ta && !previous) return;
  const text = previous ? previous.text : ta.value.trim();
  if (!text) {
    showToast('先输入一句指令');
    return;
  }

  if (text.length > 20000) { showToast('单次消息不能超过 2 万字'); return; }
  const user = previous || { id: newRecordId('message'), role: 'user', time: '现在', text };
  if (!previous) { state.chatMessages.push(user); state.chatDraft = ''; }
  else state.chatMessages = state.chatMessages.filter(message => message.retryOf !== retryId);
  saveChatHistory();
  const provider = aiProviderConfig();
  state.chatModel = chatModelLabel();
  state.chatRequestModel = state.chatModel;
  state.chatSending = true;
  const requestId = ++state.chatRequestId;
  render();
  scrollChatToBottom();

  try {
    let replies;
    if (provider.id === 'local') replies = [buildChatReply(text)];
    else {
      if (!window.xiaoyuDesktop?.chat) throw new Error('当前预览未接入模型对话，请使用更新后的桌面版');
      const history = state.chatMessages.slice(0, state.chatMessages.indexOf(user) + 1)
        .filter(message => ['user', 'assistant'].includes(message.role) && !message.retryOf)
        .slice(-24).map(message => ({ role: message.role, content: (message.role === 'assistant' ?
          ZhixuChatFormatting.display(String(message.text)) : String(message.text)).slice(0, 20000) }));
      const context = modelChatContext();
      const result = await window.xiaoyuDesktop.chat({
        provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model,
          protocol: provider.protocol || 'auto', name: provider.name },
        messages: history, context
      });
      if (state.chatRequestId !== requestId) return;
      const model = String(result.model || '').trim() || provider.model;
      const cards = result.actions.map(action => modelChatCard(action, text)).filter(Boolean);
      const updates = result.actions.filter(action => action.type === 'work_update');
      const automatic = canAutoSyncWork(text) && updates.every(action => !action.requiresConfirmation);
      const workCard = updates.length ? modelWorkUpdateCard(updates, text, context) : null;
      const otherCards = cards.filter(card => card.type !== 'work_update');
      const reply = { role: 'assistant', time: '现在', model,
        text: ZhixuChatFormatting.display(result.reply) + (result.warnings.length ? '\n\n' + result.warnings.join('\n') : '') };
      if (workCard) {
        reply.actionCard = workCard;
        reply.text = automatic ? '正在同步工作状态。' : '请确认这组工作状态变更。';
      } else if (otherCards.length) reply.actionCard = otherCards.shift();
      else if (canAutoSyncWork(text)) reply.text += '\n\n本次未匹配到可更新的任务，工作区尚未修改。请指定任务名称或选择项目范围。';
      replies = [reply, ...otherCards.map(actionCard => ({
        role: 'assistant', time: '现在', model, text: '另有一项待确认操作。', actionCard
      }))];
      if (workCard && automatic) {
        state.chatMessages.push(...replies);
        await applyWorkUpdateMessage(reply, true);
        if (result.warnings.length) reply.text += '\n\n' + result.warnings.join('\n');
        replies = [];
      }
    }
    if (state.chatRequestId !== requestId) return;
    state.chatMessages.push(...replies);
  } catch (error) {
    if (state.chatRequestId !== requestId) return;
    state.chatMessages.push({ role: 'assistant', time: '现在', model: provider.model || '本地规则',
      text: '模型请求失败：' + documentFailureReason(error) + '\n原消息已保留，尚未执行操作，可以重试。',
      retryOf: user.id });
  } finally {
    if (state.chatRequestId !== requestId) return;
    saveChatHistory();
    state.chatSending = false;
    state.chatRequestModel = '';
    render();
    scrollChatToBottom();
  }
}

async function applyChatAction(mode, cardId) {
  ensureChat();
  const cardMsg = [...state.chatMessages].reverse().find(m => m.actionCard &&
    m.actionCard.status === 'pending' && (!cardId || m.actionCard.id === cardId));
  if (!cardMsg) {
    showToast('没有待确认的操作');
    return;
  }
  const card = cardMsg.actionCard;
  if (card.type === 'work_update') { await applyWorkUpdateMessage(cardMsg); return; }
  const p = card.projectId ? projectById(card.projectId) : null;
  if (card.projectId && !p) {
    showToast('关联项目已删除，请取消这条草稿后重新输入');
    return;
  }
  let summary = '';

  if (card.type === 'progress') {
    const target = card.progress ?? 80;
    if (p) p.progress = target;
    if (p && card.updateRisk && mode !== 'progress') raiseProjectRisk(p, card.raw);
    summary = `已更新进度：${p ? p.name : '项目'} → ${target}%`;
  } else if (card.type === 'task') {
    const sourceId = newRecordId('source');
    DB.sourceItems = DB.sourceItems || [];
    DB.sourceItems.push({ id: sourceId, raw: card.raw || card.taskTitle, source: '对话', createdAt: new Date().toISOString() });
    const newTask = {
      id: newRecordId('task'),
      title: card.taskTitle || '来自对话的任务',
      project: card.projectId || null,
      estimate: card.estimate || '1.5h',
      due: card.due || '待确认',
      priority: card.priority || 'P1', assignee: card.assignee || '',
      ai: true, sourceId, done: false, createdAt: new Date().toISOString()
    };
    const bucket = card.modelAction ? newTask.estimate === '待估时' || newTask.priority === 'P4' ? 'could' :
      ['P0', 'P1'].includes(newTask.priority) ? 'must' : 'should' : 'must';
    addConfirmedTask(newTask, card.date || DB.meta.today, bucket);
    summary = `已安排到 ${card.date || DB.meta.today}：${newTask.title}`;
  } else if (card.type === 'risk') {
    if (p) {
      if (card.modelAction) {
        DB.projectDetails[p.id] ||= detailForProject(p);
        const risks = DB.projectDetails[p.id].risks;
        let risk = risks.find(item => item.title === card.riskTitle && item.status !== 'closed');
        const score = { '低': [2, 2], '中': [3, 3], '高': [4, 4] }[card.riskLevel];
        if (!score) { showToast('风险等级无效，请重新分析'); return; }
        if (!risk) { risk = { id: newRecordId('risk'), title: card.riskTitle,
          owner: DB.user.name, action: '待补充应对措施', status: 'open' }; risks.push(risk); }
        Object.assign(risk, { level: card.riskLevel, p: score[0], i: score[1], score: score[0] * score[1] });
        p.risks = risks.filter(item => item.status !== 'closed').length;
      } else raiseProjectRisk(p, card.raw);
    }
    summary = card.modelAction ? `已更新「${p.name}」风险：${card.riskTitle} · ${card.riskLevel}` :
      `已把「${p ? p.name : '项目'}」的首条未关闭风险提升为高，请在风险登记册补充应对动作。`;
  } else if (card.type === 'project' && card.modelAction) {
    if (DB.projects.some(project => project.name === card.name)) { showToast('已有同名项目，请取消草稿并指定项目'); return; }
    DB.projects.push({ id: newRecordId('project'), name: card.name, goal: card.goal, owner: card.owner || DB.user.name,
      code: 'PRJ', color: DB.user.color, progress: 0, health: 'green', planned: 0, open: 0, risks: 0,
      next: '未安排', nextDate: '—', updated: '刚刚', members: [{ i: DB.user.initials, c: DB.user.color }],
      createdAt: new Date().toISOString() });
    summary = '已创建项目：' + card.name;
  } else {
    DB.inbox.unshift({
      id: newRecordId('inbox'), title: card.captureTitle || card.raw || '来自对话的消息',
      raw: card.raw || '', source: '对话', sourceType: 'self', person: DB.user.name,
      time: '刚刚', project: p?.id || null, confidence: 0, alternatives: [],
      due: '待确认', p50: '1h', p90: '2h', basis: '待人工确认', type: '待分类',
      priority: 'P2', subtasks: [], note: '对话原文已保留'
    });
    summary = '已保存到收件箱，等待你确认归属。';
  }

  card.status = 'done';
  if (card.raw && p) {
    const logged = autoLogProjectNote(card.raw, p.id);
    if (logged) cardMsg.loggedNote = { projectId: p.id, projectName: p.name, text: logged.note.text };
  }
  state.chatMessages.push({
    role: 'assistant', time: '现在', model: cardMsg.model || '来源未记录',
    text: summary + '\n要不要我顺手写进今天的日报？',
    quick: [{ label: '写进日报', view: 'reports' }, { label: '查看今日', view: 'today' }]
  });
  saveChatHistory();
  render();
  scrollChatToBottom();
  try {
    await persistWorkbench();
    showToast(summary);
  } catch (error) { /* The storage adapter displays the error. */ }
}

function cancelChat(cardId) {
  ensureChat();
  const cardMsg = [...state.chatMessages].reverse().find(m => m.actionCard &&
    m.actionCard.status === 'pending' && (!cardId || m.actionCard.id === cardId));
  if (cardMsg) cardMsg.actionCard.status = 'cancelled';
  state.chatMessages.push({
    role: 'assistant', time: '现在', model: cardMsg?.model || '系统',
    text: '好的，不改。需要的话我可以先放到收件箱，等你之后再定。'
  });
  saveChatHistory();
  render();
  scrollChatToBottom();
  showToast('已取消，没有写入');
}

function polishText(text, tone) {
  let t = String(text || '').trim()
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  if (!t) return '';
  t = t.replace(/那个|就是|然后呢|怎么说呢|其实|基本上|大概/g, '')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/。\s*。/g, '。')
    .trim();

  if (tone === '简洁') {
    t = t.replace(/帮我|麻烦你|麻烦|一下|稍微|可能|我觉得|我个人觉得/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[，,。\s]+/, '');
  } else if (tone === '正式') {
    t = t.replace(/帮我/g, '请协助')
      .replace(/搞定/g, '完成')
      .replace(/说一下/g, '同步')
      .replace(/尽快/g, '请于今日内');
    if (!/^您好/.test(t)) t = '您好，' + t;
    if (!/[。！？]$/.test(t)) t += '。';
    t += '\n谢谢。';
  } else if (tone === '有说服力') {
    t = t.replace(/帮我/g, '建议');
    t = `建议优先推进：${t.replace(/[。！？]$/, '')}。\n原因：与本周关键交付直接相关。\n期望：请确认优先级与截止时间。`;
  } else if (tone === '温和') {
    t = t.replace(/必须/g, '尽量')
      .replace(/马上/g, '有空时')
      .replace(/尽快/g, '方便时')
      .replace(/搞定/g, '推进');
    if (!/^方便的话/.test(t)) t = '方便的话，' + t;
    if (!/[。！？]$/.test(t)) t += '。';
    t += '\n辛苦了，谢谢。';
  }

  return t.replace(/\n{3,}/g, '\n\n').trim();
}

function openPolish() {
  ensureChat();
  const input = document.getElementById('chat-input');
  const lastUser = [...(state.chatMessages || [])].reverse().find(m => m.role === 'user');
  const source = (input && input.value.trim())
    || (lastUser && lastUser.text)
    || '帮我把这周的联调问题整理一下，下午给王总汇报，重点是测试库还没开通，可能会影响演示。';
  state.polishSource = source;
  state.polishText = source;
  state.polishTone = state.polishTone || '简洁';
  state.polishResult = polishText(source, state.polishTone);
  state.polishLoading = false;
  state.polishStatus = hasAIProvider() ? 'loading' : 'local';
  state.polishStatusText = '';
  renderPolishModal();
  schedulePolishAI(true);
}

function polishStatusHtml() {
  const provider = aiProviderConfig();
  if (state.polishLoading || state.polishStatus === 'loading') return `<span class="ai-dot"></span> ${esc(provider.name)} 润色中…`;
  if (state.polishStatus === 'ai') return `<span class="ai-dot"></span> ${esc(provider.name)} · ${esc(provider.model)}`;
  if (state.polishStatus === 'error') return `${icon('alert', 11)} 已回退本地`;
  return `${icon('shield', 11)} 本地规则`;
}

function polishStatusDetail() {
  if (state.polishStatusText) return state.polishStatusText;
  if (hasAIProvider()) return '只改表达，不改事实与数字';
  return '在设置中配置 DeepSeek 或自定义供应商后可启用 AI 润色';
}

async function requestAIPolish(text, tone, provider) {
  const cfg = provider || aiProviderConfig();
  let res;
  try {
    res = await requestPolish({
        text,
        tone,
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        protocol: cfg.protocol || 'auto',
        provider: cfg.name
    });
  } catch (err) {
    throw new Error('无法连接本地代理，请用 server.py 启动预览');
  }
  let data = null;
  try { data = await res.json(); } catch (err) { /* static server may return HTML */ }
  if (!res.ok) {
    if (res.status === 404 || res.status === 501) {
      throw new Error('未启动 AI 代理，请用 server.py 启动预览');
    }
    const msg = data && (data.message || data.error);
    throw new Error(msg || `${cfg.name} 请求失败（${res.status}）`);
  }
  if (!data || !data.text) throw new Error(`${cfg.name} 返回为空`);
  return String(data.text).trim();
}

function schedulePolishAI(immediate = false) {
  const provider = aiProviderConfig();
  state.polishRequestId += 1;
  const requestId = state.polishRequestId;
  if (state.polishTimer) clearTimeout(state.polishTimer);
  state.polishTimer = null;

  if (provider.id === 'local' || !state.polishText.trim()) {
    state.polishLoading = false;
    state.polishStatus = 'local';
    state.polishStatusText = '';
    updatePolishAIStatus();
    return;
  }

  state.polishLoading = true;
  state.polishStatus = 'loading';
  state.polishStatusText = '';
  updatePolishAIStatus();
  const text = state.polishText;
  const tone = state.polishTone;

  state.polishTimer = setTimeout(async () => {
    state.polishTimer = null;
    try {
      const result = await requestAIPolish(text, tone, provider);
      if (requestId !== state.polishRequestId) return;
      state.polishResult = result;
      state.polishLoading = false;
      state.polishStatus = 'ai';
      state.polishStatusText = '';
      updatePolishPreview();
      updatePolishAIStatus();
    } catch (err) {
      if (requestId !== state.polishRequestId) return;
      state.polishLoading = false;
      state.polishStatus = 'error';
      state.polishStatusText = `${provider.name} 调用失败：` + ((err && err.message) || '未知错误');
      if (state.polishStatusText.length > 120) state.polishStatusText = state.polishStatusText.slice(0, 120) + '…';
      updatePolishAIStatus();
    }
  }, immediate ? 0 : 650);
}

function updatePolishPreview() {
  const preview = document.getElementById('polish-preview');
  if (preview) preview.innerHTML = esc(state.polishResult).replace(/\n/g, '<br>');
  const count = document.getElementById('polish-result-count');
  if (count) count.textContent = state.polishResult.length;
}

function updatePolishAIStatus() {
  const el = document.getElementById('polish-ai-status');
  if (el) {
    el.className = 'polish-ai-status ' + (state.polishLoading ? 'loading' : state.polishStatus);
    el.innerHTML = polishStatusHtml();
  }
  const detail = document.getElementById('polish-ai-detail');
  if (detail) detail.textContent = polishStatusDetail();
  const config = document.getElementById('polish-config-btn');
  if (config) config.style.display = hasAIProvider() && state.polishStatus === 'ai' ? 'none' : '';
}

function renderPolishModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const tones = ['简洁', '正式', '有说服力', '温和'];

  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal lg" role="dialog" aria-modal="true" aria-label="内容润色">
        <div class="modal-head">
          <span class="modal-icon">${icon('sparkles', 17)}</span>
          <div>
            <h2>内容润色</h2>
            <p class="sub">先预览，再替换输入框；不会自动发送。</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="polish-tone-row">
            <span class="tiny muted" style="align-self:center;margin-right:2px">语气</span>
            ${tones.map(t => `<button class="chip ${state.polishTone === t ? 'accent' : ''}" data-action="polish-tone" data-tone="${t}">${t}</button>`).join('')}
          </div>
          <div class="polish-ai-row">
            <span class="polish-ai-status ${state.polishLoading ? 'loading' : state.polishStatus}" id="polish-ai-status">${polishStatusHtml()}</span>
            <span class="tiny muted" id="polish-ai-detail">${esc(polishStatusDetail())}</span>
            <button class="btn btn-sm btn-ghost" id="polish-config-btn" data-action="profile-settings">${icon('settings', 11)} 配置供应商</button>
          </div>
          <div class="polish-grid">
            <div class="field">
              <label>原文</label>
              <textarea class="textarea" id="polish-original" placeholder="输入要润色的内容…">${esc(state.polishText)}</textarea>
              <div class="hint"><span id="polish-original-count">${state.polishText.length}</span> 字 · 可直接编辑</div>
            </div>
            <div class="field">
              <label>润色后</label>
              <div class="polish-preview" id="polish-preview">${esc(state.polishResult).replace(/\n/g, '<br>')}</div>
              <div class="hint"><span id="polish-result-count">${state.polishResult.length}</span> 字 · 只改表达，不改数字与截止</div>
            </div>
          </div>
          <div class="polish-note">${icon('shield', 12)} 由当前 AI 供应商只调整结构与语气，不新增具体事实；确认后才会替换输入框，仍需你手动发送。</div>
        </div>
        <div class="modal-foot">
          <div class="left">
            <button class="btn btn-sm btn-ghost" data-action="polish-reset">${icon('refresh', 12)} 恢复原文</button>
          </div>
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn" data-action="polish-copy">${icon('copy', 12)} 复制</button>
          <button class="btn btn-primary" data-action="polish-apply">${icon('check', 12)} 替换输入框</button>
        </div>
      </div>
    </div>
  `;
  updatePolishAIStatus();
}

function syncPolishOriginal() {
  const el = document.getElementById('polish-original');
  if (el) state.polishText = el.value;
}

function refreshPolishPreview() {
  state.polishResult = polishText(state.polishText, state.polishTone);
  updatePolishPreview();
  schedulePolishAI(false);
}

function setPolishTone(tone) {
  syncPolishOriginal();
  state.polishTone = tone;
  state.polishResult = polishText(state.polishText, tone);
  state.polishLoading = false;
  state.polishStatus = deepseekKey() ? 'loading' : 'local';
  state.polishStatusText = '';
  renderPolishModal();
  schedulePolishAI(true);
}

function applyPolish() {
  syncPolishOriginal();
  const polished = String(state.polishResult || polishText(state.polishText, state.polishTone)).trim();
  const ta = document.getElementById('chat-input');
  state.chatDraft = polished;
  if (ta) ta.value = polished;
  closeModal();
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  showToast('已替换输入框，可继续编辑或发送');
}

function copyPolish() {
  syncPolishOriginal();
  const text = String(state.polishResult || polishText(state.polishText, state.polishTone)).trim();
  const done = () => showToast('润色结果已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => showToast('复制失败，请手动选择'));
  } else {
    showToast('当前环境不支持自动复制');
  }
}

function resetPolish() {
  state.polishText = state.polishSource;
  state.polishResult = polishText(state.polishText, state.polishTone);
  state.polishLoading = false;
  state.polishStatus = deepseekKey() ? 'loading' : 'local';
  state.polishStatusText = '';
  renderPolishModal();
  schedulePolishAI(true);
}

function renderChatShortcutsModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const rows = state.chatShortcutsDraft.map(item => `
    <div class="shortcut-row" data-id="${esc(item.id)}">
      <input class="input shortcut-label" value="${esc(item.label)}" placeholder="按钮名称" aria-label="快捷指令名称">
      <input class="input shortcut-text" value="${esc(item.text || '')}" placeholder="填入输入框的完整指令" aria-label="快捷指令内容">
      <button class="icon-btn sm shortcut-remove" data-action="chat-shortcut-remove" data-id="${esc(item.id)}" aria-label="删除快捷指令">${icon('trash', 13)}</button>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal lg" role="dialog" aria-modal="true" aria-label="自定义快捷指令">
        <div class="modal-head">
          <span class="modal-icon">${icon('command', 17)}</span>
          <div>
            <h2>自定义快捷指令</h2>
            <p class="sub">把自己常用的说法放在输入框上方。点击只填入输入框，不会自动发送。</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="shortcut-list">${rows || '<div class="shortcut-empty">还没有快捷指令。添加一条，下次一句话就能开始。</div>'}</div>
          <button class="btn btn-sm mt-12" data-action="chat-shortcut-add">${icon('plus', 12)} 添加快捷指令</button>
          <div class="shortcut-tip">${icon('lightbulb', 12)} 建议 3–6 条：一条更新进展、一条拆任务、一条生成周报。名称短，指令完整。</div>
        </div>
        <div class="modal-foot">
          <div class="left">
            <button class="btn btn-sm btn-ghost" data-action="chat-shortcut-reset">${icon('refresh', 12)} 恢复默认</button>
          </div>
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-primary" data-action="chat-shortcut-save">${icon('check', 12)} 保存快捷指令</button>
        </div>
      </div>
    </div>
  `;
}

function openChatShortcuts() {
  ensureChatShortcuts();
  state.chatShortcutsDraft = JSON.parse(JSON.stringify(state.chatShortcuts));
  renderChatShortcutsModal();
}

function syncChatShortcutsDraft() {
  const rows = [...document.querySelectorAll('.shortcut-row')];
  state.chatShortcutsDraft = rows.map(row => ({
    id: row.dataset.id,
    label: row.querySelector('.shortcut-label').value.trim(),
    text: row.querySelector('.shortcut-text').value.trim()
  }));
}

function addChatShortcut() {
  syncChatShortcutsDraft();
  state.chatShortcutsDraft.push({ id: 's-' + Date.now(), label: '', text: '' });
  renderChatShortcutsModal();
  requestAnimationFrame(() => {
    const rows = [...document.querySelectorAll('.shortcut-row')];
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.shortcut-label').focus();
  });
}

function removeChatShortcut(id) {
  syncChatShortcutsDraft();
  state.chatShortcutsDraft = state.chatShortcutsDraft.filter(item => item.id !== id);
  renderChatShortcutsModal();
}

function resetChatShortcuts() {
  state.chatShortcutsDraft = defaultChatShortcuts();
  renderChatShortcutsModal();
}

function saveChatShortcuts() {
  syncChatShortcutsDraft();
  const shortcuts = state.chatShortcutsDraft
    .filter(item => item.label && item.text)
    .map(item => ({ id: item.id, label: item.label, text: item.text }));
  state.chatShortcuts = shortcuts;
  try { storageSet('jw-chat-shortcuts', JSON.stringify(shortcuts)); } catch (e) { /* ignore */ }
  closeModal();
  render();
  showToast(shortcuts.length ? '快捷指令已保存' : '已清空快捷指令，可随时再添加');
}

function fillChatInput(text) {
  state.chatDraft = text;
  const ta = document.getElementById('chat-input');
  if (!ta) return;
  ta.value = text;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
