/* Sidebar, topbar, today view, inbox view */

function renderSidebar() {
  const cfg = aiProviderConfig();
  const nav = [
    { id: 'chat', label: '对话', icon: 'message', badge: 'AI', badgeClass: 'ai' },
    { id: 'today', label: '今日', icon: 'sun', badge: String(DB.tasks.must.filter(t => !t.done).length), badgeClass: 'accent' },
    { id: 'inbox', label: '收件箱', icon: 'inbox', badge: String(DB.inbox.length), badgeClass: 'accent' },
    { id: 'projects', label: '项目', icon: 'layout', badge: String(DB.projects.length) },
    { id: 'reports', label: '报表', icon: 'file' },
    { id: 'profile', label: '画像', icon: 'user' },
    { id: 'data', label: '数据与集成', icon: 'database' }
  ];

  const projects = DB.projects.map(p => `
    <button class="project-nav-item ${state.view === 'project' && state.projectId === p.id ? 'active' : ''}" data-action="project" data-id="${p.id}">
      <span class="dot" style="background:${p.color}"></span>
      <span class="pname">${esc(p.name)}</span>
      ${p.health === 'red' ? '<span class="risk-dot" title="有风险"></span>' : ''}
      <span class="pcount">${allWorkbenchTasks().filter(t => t.project === p.id && !t.done).length}</span>
    </button>
  `).join('');

  return `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 12c2.5-3 6-4.2 9.5-2.2 1.3.8 2.3 1.7 3.5 2.2-1.2.5-2.2 1.4-3.5 2.2C14 16.2 10.5 15 8 12Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M8 12c-1.5-1.8-3.3-2.8-5.5-3 .6 1.4.6 4.6 0 6 2.2-.2 4-1.2 5.5-3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity=".65"/>
            <circle cx="16.3" cy="10.8" r=".8" fill="currentColor"/>
          </svg>
        </span>
        <span class="brand-text">
          <span class="brand-name">${esc(assistantName())}</span>
          <span class="brand-sub">Personal Workbench</span>
        </span>
      </div>

      <button class="workspace-switch" data-action="profile-settings">
        <span class="workspace-avatar">${esc((DB.user.name || '李').slice(0, 1))}</span>
        <span class="workspace-meta">
          <span class="workspace-name">${esc(DB.user.workspace || DB.user.name + '的工作台')}</span>
          <span class="workspace-sub" id="workspace-storage-status">${window.xiaoyuDesktop ? '本地 · SQLite' : '本地 · 浏览器保存'}</span>
        </span>
        ${icon('chevronDown', 13)}
      </button>

      <nav class="nav">
        ${nav.map(item => `
          <button class="nav-item ${state.view === item.id || (item.id === 'projects' && state.view === 'project') ? 'active' : ''}" data-action="nav" data-view="${item.id}">
            ${icon(item.icon, 17, 'nav-icon')}
            <span class="nav-label">${item.label}</span>
            ${item.badge ? `<span class="nav-badge ${item.badgeClass || ''}">${item.badge}</span>` : ''}
          </button>
        `).join('')}
      </nav>

      <div class="side-section">
        <span class="side-label">项目</span>
        <button class="side-add" data-action="new-project" title="新建项目" aria-label="新建项目">${icon('plus', 13)}</button>
      </div>
      <div class="project-nav">
        ${projects}
        <button class="all-projects" data-action="nav" data-view="projects">
          所有项目 ${icon('arrowRight', 12)}
        </button>
      </div>

      <div class="sidebar-footer">
        <div class="ai-status-card">
          <span class="pulse ${cfg.id === 'local' ? 'off' : ''}" id="sidebar-ai-pulse"></span>
          <span><span class="ai-model" id="sidebar-ai-name">${esc(cfg.name)}</span> · <span id="sidebar-ai-status">${cfg.id === 'local' ? '未配置' : '已配置'}</span></span>
          ${icon('sparkles', 13, 'ai-spark')}
        </div>
        <button class="user-chip" data-action="profile-settings" title="编辑姓名、角色、头像与助手名称">
          <span class="avatar md" style="background:${DB.user.color}">${esc(DB.user.initials)}</span>
          <span class="user-meta">
            <span class="user-name">${esc(DB.user.name)}</span>
            <span class="user-role">${esc(DB.user.role)}</span>
          </span>
          ${icon('edit', 12, 'more')}
        </button>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  const cfg = aiProviderConfig();
  const titles = {
    today: '今日',
    chat: '对话',
    inbox: '收件箱',
    projects: '项目',
    project: '项目详情',
    reports: '报表',
    profile: '画像',
    data: '数据与集成'
  };
  const title = titles[state.view] || '今日';
  const isDark = document.documentElement.dataset.theme === 'dark';

  return `
    <header class="topbar">
      <div class="crumbs">
        <span>工作台</span>
        <span class="sep">/</span>
        <strong>${title}</strong>
      </div>

      <button class="top-search" data-action="command" aria-label="打开命令面板">
        ${icon('search', 14)}
        <span>搜索任务、项目、文档…</span>
        <span class="kbd">Ctrl K</span>
      </button>

      <div class="top-actions">
        <div class="ai-pill" id="topbar-ai-pill">
          <span class="dot ${cfg.id === 'local' ? 'off' : ''}"></span>
          <strong>${esc(cfg.name)}</strong>
          <span>${cfg.id === 'local' ? '未配置 · 本地规则' : '已配置 · ' + esc(cfg.model)}</span>
        </div>
        <button class="icon-btn" data-action="notifications" aria-label="通知">
          ${icon('bell', 17)}
        </button>
        <button class="btn btn-primary btn-sm" data-action="capture">
          ${icon('plus', 14)}
          快速捕获
          <span class="kbd" style="background:transparent;border-color:rgba(255,255,255,.28);color:inherit">Ctrl Space</span>
        </button>
        <button class="icon-btn" data-action="theme" aria-label="切换主题">
          ${icon(isDark ? 'sun' : 'moon', 17)}
        </button>
      </div>
    </header>
  `;
}

function taskRow(t) {
  const p = t.project ? projectById(t.project) : null;
  const dueToday = t.due && (t.due.includes('今天') || t.due.includes('18:00'));
  const dueTone = t.overdue ? 'overdue' : dueToday ? 'today' : '';
  const meta = `
    ${p ? projectChip(t.project) : '<span class="proj"><i style="background:var(--ink-3)"></i>个人</span>'}
    <span>${esc(t.estimate)}</span>
    <span class="due ${dueTone}">${esc(t.due)}</span>
    ${t.ai ? `<span class="ai-tag">${icon('sparkles', 11)} AI 估时</span>` : ''}
  `;

  return `
    <div class="task-row ${t.focus ? 'focus' : ''} ${t.done ? 'done' : ''}" data-task="${t.id}">
      <button class="check" data-action="check" aria-label="${t.done ? '已完成' : '标记完成'}">${icon('check', 11)}</button>
      <div class="task-main">
        <div class="task-title-row">
          <span class="task-title">${esc(t.title)}</span>
          <span class="priority ${t.priority.toLowerCase()}">${t.priority}</span>
        </div>
        <div class="task-meta">${meta}</div>
        ${t.blocked ? `<div class="task-note blocked">${icon('alert', 11)} ${esc(t.note || '任务存在阻塞')}</div>` : ''}
        ${t.focus ? `
          <div class="task-note">${icon('arrowRight', 11)} ${esc(t.note)}</div>
          <div class="sub-progress">
            <div class="bar"><span style="width:${t.progress}%"></span></div>
            <span class="txt">子任务 ${t.subtasks} · ${t.progress}%</span>
          </div>
        ` : ''}
      </div>
      <div class="task-side">
        <button class="icon-btn sm ${DB.runningTimer?.taskId === t.id ? 'timer-running' : ''}" data-action="task-timer" title="${esc(timerLabel(t.id))}" aria-label="${esc(timerLabel(t.id))}">${icon(DB.runningTimer?.taskId === t.id ? 'clock' : 'play', 13)}</button>
        <button class="icon-btn sm" data-action="task-edit" data-id="${esc(t.id)}" title="编辑任务" aria-label="编辑任务">${icon('more', 14)}</button>
      </div>
    </div>
  `;
}

function renderToday() {
  const c = DB.capacity;
  const baseToday = DB.meta.today;
  const selected = state.todayDate || baseToday;
  const range = state.todayRange || 'day';
  const isToday = range === 'day' && selected === baseToday;
  const isPast = range === 'day' && selected < baseToday;
  const weekStart = range === 'week' ? startOfWeekISO(selected) : selected;
  const weekEnd = range === 'week' ? addDaysISO(weekStart, 6) : selected;
  const yesterday = addDaysISO(baseToday, -1);
  const tomorrow = addDaysISO(baseToday, 1);
  const nextWeekStart = nextMondayISO(baseToday);
  const nextWeekEnd = addDaysISO(nextWeekStart, 6);
  const weekLabel = weekStart === startOfWeekISO(baseToday) ? '本周' : weekStart === nextWeekStart ? '下周' : '所选周';

  const todayTasks = [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could];
  const dayTasks = range === 'week'
    ? tasksInRange(weekStart, weekEnd)
    : isToday ? todayTasks : tasksOnDate(selected);
  const doneTasks = isPast ? dayTasks.filter(t => t.done) : [];
  const openTasks = isPast ? dayTasks.filter(t => !t.done) : dayTasks;
  const totalHours = dayTasks.reduce((sum, t) => sum + parseEstimateHours(t.estimate), 0);
  const doneHours = doneTasks.reduce((sum, t) => sum + parseEstimateHours(t.estimate), 0);

  const meetingW = Math.min(100, c.meeting / c.available * 100);
  const focusW = Math.min(100 - meetingW, c.focus / c.available * 100);
  const flexW = Math.max(0, 100 - meetingW - focusW);
  const committedPct = Math.min(100, c.committed / c.available * 100);
  const remaining = (c.available - c.committed).toFixed(1);

  const isYesterday = range === 'day' && selected === yesterday;
  const isTomorrow = range === 'day' && selected === tomorrow;
  const dateHeading = range === 'week'
    ? `${formatDateRange(weekStart, weekEnd)} · ${weekLabel}`
    : formatDateFull(selected);
  const heading = isToday
    ? `早上好，${DB.user.name}`
    : range === 'week'
      ? `${weekLabel}的任务`
      : isYesterday
        ? '昨天完成了什么'
        : isTomorrow
          ? '明天要做什么'
          : `${formatDateShort(selected)}的任务`;

  let summary = '';
  if (isToday) {
    summary = `今天有 <strong>${DB.tasks.must.filter(t => !t.done).length} 件必做</strong>、<strong>${DB.overdue.length} 项逾期</strong>。预计投入 ${c.committed}h，可用 ${c.available}h。`;
  } else if (isPast) {
    summary = dayTasks.length
      ? `${isYesterday ? '昨天' : '这一天'}共 <strong>${dayTasks.length} 项</strong>，已完成 <strong>${doneTasks.length} 项</strong>，预计投入 ${formatHours(totalHours)}。${openTasks.length ? `<span class="date-open">${openTasks.length} 项未完成</span>` : ''}`
      : '这一天没有安排任务。';
  } else {
    summary = dayTasks.length
      ? `${range === 'week' ? weekLabel : isTomorrow ? '明天' : '这一天'}共 <strong>${dayTasks.length} 项</strong>，预计投入 ${formatHours(totalHours)}。`
      : '这一天没有安排任务。';
  }

  const taskSection = (label, tasks, count) => `
    <div class="task-section-label">
      <span>${label}</span>
      <span class="count-badge">${count}</span>
      <span class="line"></span>
    </div>
    ${filterTasks(tasks).map(taskRow).join('')}
  `;

  const emptyDay = `
    <div class="empty-day">
      ${icon('calendar', 20)}
      <div>
        <b>这一天没有安排</b>
        <p>切回今天，或从收件箱挑一件事放到这天。</p>
      </div>
    </div>
  `;

  let panelTitle = '今日清单';
  let taskBody = '';
  if (isToday) {
    panelTitle = '今日清单';
    taskBody = taskSection('必做 · Must', DB.tasks.must, DB.tasks.must.length)
      + taskSection('推进 · Should', DB.tasks.should, DB.tasks.should.length)
      + taskSection('可以等 · Could', DB.tasks.could, DB.tasks.could.length);
  } else if (range === 'week') {
    panelTitle = `${weekLabel}任务`;
    const groups = [];
    let cursor = weekStart;
    while (cursor <= weekEnd) {
      const items = tasksOnDate(cursor);
      if (items.length) {
        const hours = items.reduce((sum, t) => sum + parseEstimateHours(t.estimate), 0);
        groups.push(`
          <div class="date-group">
            <div class="date-group-head">
              <b>${formatDateShort(cursor)}</b>
              <span>${items.length} 项</span>
              <span class="line"></span>
              <span>${formatHours(hours)}</span>
            </div>
            ${filterTasks(items).map(taskRow).join('')}
          </div>
        `);
      }
      cursor = addDaysISO(cursor, 1);
    }
    taskBody = groups.join('') || emptyDay;
  } else if (isPast) {
    panelTitle = isYesterday ? '昨日清单' : '当天清单';
    taskBody = (doneTasks.length ? taskSection('已完成 · Done', doneTasks, doneTasks.length) : '')
      + (openTasks.length ? taskSection('未完成 · Open', openTasks, openTasks.length) : '');
    taskBody = taskBody || emptyDay;
  } else {
    panelTitle = isTomorrow ? '明日安排' : '当天清单';
    taskBody = dayTasks.length ? taskSection('当天安排 · Scheduled', dayTasks, dayTasks.length) : emptyDay;
  }

  const waiting = DB.waiting.map(w => `
    <div class="wait-row">
      <div class="wait-title">${esc(w.title)}</div>
      <div class="wait-age ${w.days >= 3 ? 'hot' : ''}">${w.days} 天</div>
      <div class="wait-meta">
        <span class="person">${icon('user', 10)} ${esc(w.person)}</span>
        <span>·</span>
        <span>${esc(w.impact)}</span>
      </div>
    </div>
  `).join('');

  const meetings = DB.meetings.map(m => `
    <div class="meeting-row">
      <div class="meeting-time">${m.time}</div>
      <div class="meeting-rail">
        <span class="meeting-dot" style="background:${m.color}"></span>
        <span class="meeting-line"></span>
      </div>
      <div>
        <div class="meeting-title">${esc(m.title)}</div>
        <div class="meeting-meta">${m.duration} · ${esc(m.people)}</div>
      </div>
    </div>
  `).join('');

  const workday = DB.workday || { start: '09:00', end: '18:00', lunch: '12:00–14:00', blocks: [] };
  const [lunchStart, lunchEnd] = String(workday.lunch || '12:00–14:00').split('–');
  const workHours = `${workday.start}–${lunchStart} · ${lunchEnd}–${workday.end}`;
  const scheduleRows = (workday.blocks || []).map(b => `
    <div class="time-block ${b.type}">
      <span class="tb-time">${b.start}–${b.end}</span>
      <span class="tb-title">${esc(b.title)}</span>
    </div>
  `).join('');

  const quickOptions = [
    { label: '昨天', date: yesterday, range: 'day', icon: 'arrowLeft' },
    { label: '今天', date: baseToday, range: 'day', icon: 'sun' },
    { label: '明天', date: tomorrow, range: 'day', icon: 'arrowRight' },
    { label: '下周', date: nextWeekStart, range: 'week', icon: 'calendar' }
  ];
  const dateOptionRows = quickOptions.map(opt => {
    const active = opt.range === 'week'
      ? range === 'week' && weekStart === opt.date
      : range === 'day' && selected === opt.date;
    const count = opt.range === 'week'
      ? tasksInRange(opt.date, addDaysISO(opt.date, 6)).length
      : opt.date === baseToday ? todayTasks.length : tasksOnDate(opt.date).length;
    const sub = opt.range === 'week'
      ? formatDateRange(opt.date, addDaysISO(opt.date, 6))
      : formatDateShort(opt.date);
    return `
      <button class="date-option ${active ? 'active' : ''}" data-action="today-option" data-date="${opt.date}" data-range="${opt.range}">
        <span class="date-option-icon">${icon(opt.icon, 13)}</span>
        <span class="date-option-main"><b>${opt.label}</b><small>${sub}</small></span>
        <span class="date-option-count">${count} 项</span>
      </button>
    `;
  }).join('');

  const dateMenu = state.todayMenu ? `
    <div class="date-backdrop" data-action="today-close"></div>
    <div class="date-menu" role="dialog" aria-label="选择日期">
      <div class="date-menu-head">
        <span>查看日期</span>
        <button class="icon-btn sm" data-action="today-close" aria-label="关闭">${icon('x', 12)}</button>
      </div>
      <div class="date-options">${dateOptionRows}</div>
      <div class="date-custom">
        <label for="today-date-input">${icon('calendar', 12)} 指定日期</label>
        <input class="input" type="date" id="today-date-input" value="${selected}">
      </div>
    </div>
  ` : '';

  const capacityCard = `
    <div class="capacity-card card">
      <div class="capacity-top">
        <div class="capacity-title">
          今日产能
          <span class="tiny muted">会议 + 深度工作 + 弹性</span>
        </div>
        <div class="capacity-figure">
          <strong>${c.committed}h</strong> / ${c.available}h 已承诺
          <span class="muted">· 余量 ${remaining}h</span>
        </div>
      </div>
      <div class="capacity-bar" aria-label="今日产能占用">
        <span class="capacity-seg meeting" style="width:${meetingW}%" title="会议 ${c.meeting}h"></span>
        <span class="capacity-seg focus" style="width:${focusW}%" title="深度工作 ${c.focus}h"></span>
        <span class="capacity-seg flex" style="width:${flexW}%" title="弹性 ${c.buffer}h"></span>
        <span class="capacity-marker" style="left:${committedPct}%" title="承诺上限"></span>
      </div>
      <div class="capacity-legend">
        <span><i style="background:var(--violet)"></i>会议 ${c.meeting}h</span>
        <span><i style="background:var(--accent)"></i>深度工作 ${c.focus}h</span>
        <span><i style="background:var(--surface-3);box-shadow:inset 0 0 0 1px var(--line-strong)"></i>弹性 ${c.buffer}h</span>
        <span><i style="background:var(--ink)"></i>承诺上限</span>
      </div>
      <div class="work-schedule">
        <div class="work-schedule-head">
          <span class="ws-title">${icon('clock', 12)} 工作时间 <b>${workHours}</b></span>
          <span class="tiny muted">午休 ${workday.lunch}</span>
          <button class="btn btn-sm btn-ghost ws-edit" data-action="work-hours">${icon('edit', 11)} 调整</button>
        </div>
        <div class="time-blocks">${scheduleRows}</div>
      </div>
    </div>
  `;

  const dateSummary = `
    <div class="date-summary card">
      <div class="ds-item"><span class="ds-label">任务</span><span class="ds-value">${dayTasks.length} 项</span></div>
      <div class="ds-item"><span class="ds-label">预计投入</span><span class="ds-value">${formatHours(totalHours)}</span></div>
      <div class="ds-item"><span class="ds-label">${isPast ? '完成' : '状态'}</span><span class="ds-value">${isPast ? (dayTasks.length ? `${doneTasks.length}/${dayTasks.length}` : '—') : '待执行'}</span></div>
      ${isPast ? `<div class="ds-item"><span class="ds-label">完成投入</span><span class="ds-value">${formatHours(doneHours)}</span></div>` : ''}
      <div class="ds-note">工作时间 ${workHours} · ${range === 'week' ? '周视图' : '日期视图'}</div>
    </div>
  `;

  return `
    <div class="today-head">
      <div class="page-head" style="margin-bottom:14px">
        <div>
          <div class="date-nav-wrap">
            <div class="date-nav">
              <button class="icon-btn sm" data-action="today-prev" title="${range === 'week' ? '上一周' : '前一天'}" aria-label="${range === 'week' ? '上一周' : '前一天'}">${icon('arrowLeft', 14)}</button>
              <button class="date-nav-trigger ${state.todayMenu ? 'open' : ''}" data-action="today-toggle" aria-haspopup="dialog" aria-expanded="${state.todayMenu}" title="选择日期">
                ${icon('calendar', 12)}
                <span>${dateHeading}</span>
                ${icon('chevronDown', 11)}
              </button>
              <button class="icon-btn sm" data-action="today-next" title="${range === 'week' ? '下一周' : '后一天'}" aria-label="${range === 'week' ? '下一周' : '后一天'}">${icon('arrowRight', 14)}</button>
              ${!isToday ? `<button class="date-return" data-action="today-today">回到今天</button>` : ''}
            </div>
            ${dateMenu}
          </div>
          <h1>${heading}</h1>
          <p class="sub">${summary}</p>
        </div>
      </div>

      ${isToday ? capacityCard : dateSummary}
    </div>

    ${isToday ? `
      <div class="overdue-strip">
        ${icon('alert', 15)}
        <span class="title">${DB.overdue.length} 项逾期</span>
        <span class="items">${DB.overdue.map(o => `${esc(o.title)}（${o.days} 天）`).join(' · ')}</span>
        <button class="btn" data-action="overdue">现在处理 ${icon('arrowRight', 12)}</button>
      </div>
    ` : ''}

    <div class="today-grid">
      <div class="today-main">
        <div class="card task-panel">
          <div class="panel-head">
            <h3>${icon('target', 15)} ${panelTitle} <span class="count-badge">${dayTasks.length}</span></h3>
            <div class="row gap-6">
              <button class="btn btn-sm btn-ghost" data-action="task-filter">${icon('filter', 12)} ${state.taskFilterProject || state.taskFilterStatus ? '已筛选' : '筛选'}</button>
              <button class="btn btn-sm" data-action="task-filter">${state.taskSort === 'estimate' ? '预计时长' : '优先级'} ${icon('chevronDown', 11)}</button>
            </div>
          </div>
          ${taskBody}
          ${dayTasks.length && !filterTasks(dayTasks).length ? '<p class="panel-body muted">没有符合筛选条件的任务</p>' : ''}
        </div>
      </div>

      <aside class="today-rail">
        <div class="impact-card">
          <div class="eyebrow">计划外</div>
          <h3>老板又插了一件事？</h3>
          <p>先看影响，再决定接不接。系统会告诉你${isToday ? '今天' : '当天'}会挤掉什么。</p>
          <button class="btn" data-action="impact">${icon('zap', 14)} 项目影响</button>
        </div>

        <div class="card rail-card">
          <div class="rail-head">
            <h3>${icon('clock', 14)} 等待墙 <span class="chip amber">${DB.waiting.length}</span></h3>
            <button class="icon-btn sm" data-action="waiting" aria-label="管理等待事项">${icon('arrowRight', 13)}</button>
          </div>
          <div class="wait-list">${waiting}</div>
        </div>

        ${isToday ? `
          <div class="card rail-card">
            <div class="rail-head">
              <h3>${icon('calendar', 14)} 今日会议</h3>
              <span class="tiny muted">${DB.meetings.length} 场</span>
            </div>
            <div class="meeting-list">${meetings}</div>
          </div>
        ` : ''}
      </aside>
    </div>
  `;
}

function renderInbox() {
  const item = DB.inbox.find(i => i.id === state.inboxId) || DB.inbox[0];
  if (!item) return `
    <div class="page-head"><div><h1>收件箱</h1></div>
      <div class="head-actions"><button class="btn" data-action="inbox-archive">已归档</button><button class="btn btn-primary" data-action="capture">${icon('plus', 14)} 新捕获</button></div>
    </div>
    <div class="empty-day">${icon('check', 20)}<div><b>收件箱已清空</b><p>已确认的事项可以在今日清单中查看。</p></div></div>
  `;
  const tone = confidenceTone(item.confidence);
  const lowConfidence = item.confidence < 80;

  const list = DB.inbox.map(i => {
    const p = i.project ? projectById(i.project) : null;
    return `
      <button class="inbox-item ${i.id === item.id ? 'active' : ''}" data-action="inbox" data-id="${i.id}">
        <div class="inbox-item-top">
          <span class="source-badge ${sourceClass(i.source)}">${esc(i.source)}</span>
          <span class="who">${esc(i.person)}</span>
          <span class="when">${esc(i.time)}</span>
        </div>
        <div class="inbox-title">${esc(i.title)}</div>
        <div class="inbox-preview">${esc(i.raw)}</div>
        <div class="inbox-item-foot">
          <span class="conf-dot ${confidenceTone(i.confidence)}"></span>
          <span class="conf-text">${i.confidence}% · ${p ? esc(p.name) : '未归属'}</span>
        </div>
      </button>
    `;
  }).join('');

  const projectOptions = DB.projects.map(p => `<option value="${p.id}" ${item.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
    + `<option value="" ${!item.project ? 'selected' : ''}>未归属 / 新建项目</option>`;

  const subtasks = item.subtasks.map((s, idx) => `
    <div class="subtask-row">
      <span class="muted">${idx + 1}.</span>
      <span>${esc(s)}</span>
    </div>
  `).join('');

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Inbox · 待确认</div>
        <h1>收件箱</h1>
        <p class="sub">所有来源先落到这里。AI 只出草稿，你确认后才进入项目。</p>
      </div>
      <div class="head-actions">
        <button class="btn" data-action="inbox-archive">已归档</button>
        <button class="btn" data-action="inbox-batch">${icon('inbox', 14)} 批量整理</button>
        <button class="btn btn-primary" data-action="capture">${icon('plus', 14)} 新捕获</button>
      </div>
    </div>

    <div class="inbox-layout">
      <div class="card inbox-list">
        <div class="inbox-list-head">
          <h3>待处理 <span class="chip accent">${DB.inbox.length}</span> <span class="tiny muted">今天</span></h3>
        </div>
        ${list}
      </div>

      <div class="inbox-detail">
        <div class="card raw-card">
          <div class="raw-head">
            <span class="source-badge ${sourceClass(item.source)}">${esc(item.source)}</span>
            <span class="small strong">${esc(item.person)}</span>
            <span class="tiny muted">${esc(item.time)}</span>
            <span class="chip outline" style="margin-left:auto">${icon('lock', 11)} 原文保留</span>
          </div>
          <div class="raw-quote">${esc(item.raw)}</div>
          <div class="raw-foot">
            <span class="lock">${icon('shield', 11)} 本地存储 · 不会自动同步</span>
            <span>${esc(item.note)}</span>
          </div>
        </div>

        <div class="card parse-card">
          <div class="parse-head">
            <div class="ai-orb">${icon('sparkles', 16)}</div>
            <div>
              <h2>AI 解析草稿</h2>
              <p class="sub">基于原文 + 你的历史项目字典，不是最终结果</p>
            </div>
            <span class="chip ${tone} conf-chip">置信度 ${item.confidence}%</span>
          </div>

          <div class="form-grid">
            <div class="field full">
              <label>任务标题</label>
              <input class="input" id="inbox-task-title" value="${esc(item.title)}">
            </div>

            <div class="field full ${lowConfidence ? 'warn' : ''}">
              <label>归属项目</label>
              <div class="field-row">
                <select class="select" id="inbox-project">${projectOptions}</select>
                <span class="chip ${tone}">${item.confidence}%</span>
              </div>
              ${lowConfidence ? `
                <div class="basis warn">
                  ${icon('alert', 12)}
                  <span>候选：${item.alternatives.map(esc).join(' / ') || '暂无'}。请确认归属项目。</span>
                </div>
              ` : `
                <div class="hint">命中项目别名「${item.project ? esc(projectById(item.project).name) : '—'}」+ 近期任务上下文</div>
              `}
            </div>

            <div class="field">
              <label>类型</label>
              <select class="select" id="inbox-type">
                <option>${esc(item.type)}</option>
                <option>分析整理</option>
                <option>沟通协调</option>
                <option>设计评审</option>
                <option>研究探索</option>
                <option>行政事务</option>
              </select>
            </div>
            <div class="field">
              <label>截止时间</label>
              <input class="input" id="inbox-due" value="${esc(item.due)}">
            </div>

            <div class="field">
              <label>预估 P50</label>
              <input class="input" id="inbox-estimate" value="${esc(item.p50)}">
            </div>
            <div class="field">
              <label>预估 P90</label>
              <input class="input" id="inbox-p90" value="${esc(item.p90)}">
            </div>

            <div class="field full">
              <label>估时依据</label>
              <div class="basis ${lowConfidence ? 'warn' : ''}">
                ${icon('sparkles', 12)}
                <span>${esc(item.basis)}</span>
              </div>
            </div>

            <div class="field full">
              <label>建议子任务</label>
              <div class="subtasks">${subtasks}</div>
            </div>
          </div>

          <div class="parse-footer">
            <div class="left">
              <span class="chip">${esc(item.priority)}</span>
              <span class="chip">${icon('clock', 11)} AI 估时</span>
              <span class="chip outline">${icon('link', 11)} 关联原文</span>
            </div>
            <button class="btn" data-action="inbox-split">${icon('layers', 13)} 拆分</button>
            <button class="btn" data-action="inbox-ignore">忽略</button>
            <button class="btn btn-primary" data-action="confirm-inbox">${icon('check', 13)} 确认加入今日</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
