/* Dedicated AI dialogue page */

function ensureChat() {
  if (!state.chatMessages) {
    state.chatMessages = [{ role: 'assistant', time: '现在', model: '本地指令',
      text: '告诉我要安排的任务、项目进度或风险。写入前会提供待确认的草稿。' }];
  }
}

function saveChatHistory() {
  try {
    storageSet('jw-chat-history', JSON.stringify((state.chatMessages || []).slice(-60)));
  } catch (e) { /* ignore */ }
}

function defaultChatShortcuts() {
  return [
    { id: 's-progress', label: '更新项目进展', text: '把星火项目的联调进度更新到 80%，测试库风险升到高' },
    { id: 's-task', label: '把消息拆成任务', text: '把王总在飞书说的竞品分析拆成任务，今天 17:00 前给结论' },
    { id: 's-report', label: '生成本周周报', text: '基于本周事实生成周报，重点写风险和下周计划' },
    { id: 's-capacity', label: '检查今天能否接活', text: '今天还能接一个 2 小时的临时任务吗？' }
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
          ${card.type === 'progress' ? `<button class="btn btn-sm" data-action="chat-apply" data-id="${card.id}" data-mode="progress">只更新进度</button>` : ''}
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
      <button class="shortcut-add" data-action="chat-shortcuts" title="自定义快捷指令">${icon('plus', 12)} 自定义</button>
    </div>
  `;
}

function renderChatMessage(m) {
  const isUser = m.role === 'user';
  const avatar = isUser
    ? `<span class="chat-avatar user" style="background:${DB.user.color}">${esc(DB.user.initials)}</span>`
    : `<span class="chat-avatar ai">${icon('sparkles', 14)}</span>`;
  const meta = isUser ? `你 · ${m.time}` : `${esc(assistantName())} · ${m.model || state.chatModel} · ${m.time}`;
  const text = isUser
    ? String(m.text || '')
    : String(m.text || '').replace(/^早上好，[^。]+。/, `早上好，${DB.user.name}。`);
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
        ${m.actionCard ? renderChatActionCard(m.actionCard) : ''}
        ${m.quick ? renderChatQuick(m.quick) : ''}
        <div class="chat-meta">${meta}</div>
      </div>
    </div>
  `;
}

function renderChatLoading() {
  return `
    <div class="chat-msg assistant">
      <span class="chat-avatar ai">${icon('sparkles', 14)}</span>
      <div class="chat-msg-body">
        <div class="chat-bubble chat-loading"><i></i><i></i><i></i></div>
        <div class="chat-meta">正在用 ${esc(state.chatModel)} 匹配项目、任务与工作流…</div>
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
        <div class="eyebrow">Dialogue · 说一句话就执行</div>
        <h1>跟${esc(assistantName())}说一句话</h1>
      </div>
      <div class="head-actions">
        <span class="chat-memory">${icon('layers', 12)} 连续记忆 · 项目 / 任务 / 工作流</span>
      </div>
    </div>

    <div class="chat-layout">
      <section class="card chat-main">
        <div class="chat-thread" id="chat-thread">
          ${state.chatMessages.map(renderChatMessage).join('')}
          ${state.chatSending ? renderChatLoading() : ''}
        </div>

        <div class="chat-composer">
          ${renderChatShortcuts()}

          <div class="composer-box">
            <textarea id="chat-input" rows="2" placeholder="直接说：把星火项目进展更新到 80%，测试库风险升到高……"></textarea>
            <div class="composer-bar">
              <button class="icon-btn sm" data-action="chat-attachment" title="上传附件" aria-label="上传附件">${icon('plus', 14)}</button>
              <button class="icon-btn sm" data-action="document-library" title="附件记录与待确认项目" aria-label="附件记录与待确认项目">${icon('file', 14)}</button>
              <select class="chat-select" id="chat-context" aria-label="参考范围">
                ${contexts.map(c => `<option value="${c.id}" ${state.chatContext === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
              <button class="composer-tool" data-action="open-polish" title="润色输入内容">${icon('sparkles', 13)} 润色</button>
              <span class="composer-spacer"></span>
              <span class="small muted">本地指令</span>
              <button class="send-btn" data-action="chat-send" aria-label="发送">${icon('arrowUp', 16)}</button>
            </div>
          </div>
          <div class="composer-hint">Enter 发送 · Shift+Enter 换行 · 写操作会先给你确认</div>
        </div>
      </section>

      <aside class="chat-rail">
        <div class="card">
          <div class="panel-head"><h3>${icon('layers', 14)} AI 正在参考</h3><span class="chip green">本地</span></div>
          <div class="panel-body">
            <div class="chat-context-list">
              <div><span>项目字典</span><b>${DB.projects.length} 个</b></div>
              <div><span>任务记录</span><b>${allWorkbenchTasks().length} 条</b></div>
              <div><span>今日产能</span><b>${DB.capacity.committed} / ${DB.capacity.available}h</b></div>
              <div><span>工作流</span><b>v${DB.workflow.version}</b></div>
              <div><span>快捷指令</span><b>${state.chatShortcuts.length} 条</b></div>
            </div>
            <button class="btn btn-block mt-12" data-action="nav" data-view="data">${icon('settings', 12)} 调整参考范围</button>
          </div>
        </div>

        <div class="card">
          <div class="panel-head"><h3>${icon('zap', 14)} 可执行操作</h3></div>
          <div class="panel-body">
            <div class="chat-capability"><span>更新任务进度</span><b>需确认</b></div>
            <div class="chat-capability"><span>新建任务</span><b>需确认</b></div>
            <div class="chat-capability"><span>更新风险等级</span><b>需确认</b></div>
            <div class="chat-capability"><span>内容润色 / 改写</span><b>可预览</b></div>
            <div class="chat-capability"><span>自定义快捷指令</span><b>可编辑</b></div>
            <div class="chat-capability"><span>生成日报 / 周报</span><b>可预览</b></div>
          </div>
        </div>

        <div class="card chat-safety">
          <div class="panel-body">
            <div class="eyebrow">安全边界</div>
            <p>本地指令生成草稿，确认后才写入。润色使用个人设置中的供应商。</p>
            <div class="tiny muted mt-8">完整模型对话尚未接入。</div>
          </div>
        </div>
      </aside>
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
      if (!result || !note) return;
      note.text = result;
      saveProjectNotes();
      if (activity) activity.text = '新增项目记录：' + (result.length > 36 ? result.slice(0, 36) + '…' : result);
      if (state.view === 'project' && state.projectId === projectId && state.projectTab === 'notes') render();
    })
    .catch(() => { /* keep the local polish */ });
}

function autoLogProjectNote(text, projectId) {
  const p = projectId ? projectById(projectId) : matchProjectByText(text);
  if (!p) return null;
  const raw = String(text || '').trim();
  if (!raw) return null;

  const polished = polishProjectNote(raw) || raw;
  const note = {
    id: 'n-' + Date.now(),
    time: '现在',
    text: polished,
    raw,
    source: '对话',
    author: DB.user.name
  };
  projectNotesFor(p.id).unshift(note);

  if (!DB.projectDetails[p.id]) DB.projectDetails[p.id] = detailForProject(p);
  const activity = {
    time: '现在',
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

function sendChat() {
  ensureChat();
  const ta = document.getElementById('chat-input');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) {
    showToast('先输入一句指令');
    return;
  }

  state.chatMessages.push({ role: 'user', time: '现在', text });
  saveChatHistory();
  state.chatModel = '本地指令';
  state.chatSending = true;
  const requestId = ++state.chatRequestId;
  render();
  scrollChatToBottom();

  setTimeout(() => {
    if (state.chatRequestId !== requestId) return;
    const reply = buildChatReply(text);
    state.chatMessages.push(reply);
    saveChatHistory();
    state.chatSending = false;
    render();
    scrollChatToBottom();
  }, 720);
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
      priority: 'P1',
      ai: true, sourceId, done: false, createdAt: new Date().toISOString()
    };
    addConfirmedTask(newTask, card.date || DB.meta.today, 'must');
    summary = `已安排到 ${card.date || DB.meta.today}：${newTask.title}`;
  } else if (card.type === 'risk') {
    if (p) {
      raiseProjectRisk(p, card.raw);
    }
    summary = `已把「${p ? p.name : '项目'}」的首条未关闭风险提升为高，请在风险登记册补充应对动作。`;
  } else {
    DB.inbox.unshift({
      id: newRecordId('inbox'), title: card.raw || '来自对话的消息',
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
    role: 'assistant', time: '现在', model: state.chatModel,
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
    role: 'assistant', time: '现在', model: state.chatModel,
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
  const ta = document.getElementById('chat-input');
  if (!ta) return;
  ta.value = text;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
