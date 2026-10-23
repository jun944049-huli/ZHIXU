/* Sidebar, topbar, today view, inbox view */

function renderSidebar() {
  const nav = [
    { id: 'today', label: '今天', icon: 'sun',
      badge: [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could].filter(t => !t.done).length,
      countLabel: '项待办', badgeClass: 'accent' },
    { id: 'chat', label: '对话', icon: 'message' },
    { id: 'inbox', label: '收件箱', icon: 'inbox', badge: DB.inbox.length,
      countLabel: '项待处理', badgeClass: 'accent' },
    { id: 'projects', label: '项目', icon: 'folder', badge: DB.projects.length, countLabel: '个项目' },
    { id: 'reports', label: '报告', icon: 'file', secondary: true },
    { id: 'profile', label: '回顾', icon: 'chart', secondary: true },
    { id: 'data', label: '连接与数据', icon: 'database', secondary: true }
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
      <div class="brand" aria-label="知序">
        ${brandImage()}
        <span class="brand-name">知序</span>
      </div>

      <button class="workspace-switch" data-action="profile-settings" title="工作台设置" aria-label="工作台设置">
        <span class="workspace-avatar" style="background:${esc(DB.user.color)}">${profileAvatarContent()}</span>
        <span class="workspace-meta">
          <span class="workspace-name">${esc(DB.user.workspace || DB.user.name + '的工作台')}</span>
          <span class="workspace-sub" id="workspace-storage-status">已保存</span>
        </span>
        ${icon('chevronDown', 13)}
      </button>

      <nav class="nav">
        ${nav.map(item => `
          ${item.id === 'reports' ? '<div class="nav-divider"></div>' : ''}
          <button class="nav-item ${state.view === item.id || (item.id === 'projects' && state.view === 'project') ? 'active' : ''}" data-action="nav" data-view="${item.id}" title="${item.label}${item.countLabel ? ` · ${item.badge} ${item.countLabel}` : ''}" aria-label="${item.label}" ${item.countLabel ? `aria-describedby="nav-count-${item.id}"` : ''}>
            ${icon(item.icon, 17, 'nav-icon')}
            <span class="nav-label">${item.label}</span>
            ${item.badge ? `<span class="nav-badge ${item.badgeClass || ''}" aria-hidden="true">${item.badge > 99 ? '99+' : item.badge}</span>` : ''}
            ${item.countLabel ? `<span class="sr-only" id="nav-count-${item.id}">${item.badge} ${item.countLabel}</span>` : ''}
          </button>
        `).join('')}
      </nav>

      <div class="side-section">
        <span class="side-label">项目</span>
        <button class="side-add" data-action="new-project" title="新建项目" aria-label="新建项目">${icon('plus', 13)}</button>
      </div>
      <div class="project-nav">
        ${projects}
      </div>

    </aside>
  `;
}

function renderTopbar() {
  const cfg = aiProviderConfig();
  const titles = {
    today: '今天',
    chat: '对话',
    inbox: '收件箱',
    projects: '项目',
    project: '项目详情',
    reports: '报告',
    profile: '回顾',
    data: '连接与数据'
  };
  const title = titles[state.view] || '今日';
  const isDark = document.documentElement.dataset.theme === 'dark';

  return `
    <header class="topbar">
      <div class="crumbs">
        <strong>${title}</strong>
      </div>

      <button class="top-search" data-action="command" aria-label="搜索" title="搜索">
        ${icon('search', 14)}
        <span>搜索</span>
      </button>

      <div class="top-actions">
        <button class="ai-pill" id="topbar-ai-pill" data-action="model-settings" title="${cfg.id === 'local' ? '连接模型' : esc(cfg.name + ' · ' + cfg.model)}" aria-label="模型设置">
          <span class="dot ${cfg.id === 'local' ? 'off' : ''}"></span>
          <strong>${esc(cfg.name)}</strong>
          <span>${cfg.id === 'local' ? '连接模型' : esc(cfg.model)}</span>
        </button>
        <button class="icon-btn" data-action="notifications" aria-label="通知" title="通知">
          ${icon('bell', 17)}
        </button>
        <button class="btn btn-primary btn-sm" data-action="capture">
          ${icon('plus', 14)}
          新建
        </button>
        <button class="icon-btn theme-toggle" data-action="theme" aria-label="切换主题" title="切换主题">
          ${icon(isDark ? 'sun' : 'moon', 17)}
        </button>
      </div>
    </header>
  `;
}

function taskRow(t) {
  const p = t.project ? projectById(t.project) : null;
  const dueToday = t.due && (t.due.includes('今天') || t.due.includes('18:00'));
  const dueTone = isTaskOverdue(t) ? 'overdue' : dueToday ? 'today' : '';
  const meta = `
    ${p ? projectChip(t.project) : '<span class="proj"><i style="background:var(--ink-3)"></i>个人</span>'}
    <span>${esc(t.estimate)}</span>
    <span class="due ${dueTone}">${esc(t.due)}</span>
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

  const committedPct = Math.min(100, c.committed / Math.max(0.1, c.available) * 100);
  const remaining = (c.available - c.committed).toFixed(1);

  const isYesterday = range === 'day' && selected === yesterday;
  const isTomorrow = range === 'day' && selected === tomorrow;
  const dateHeading = range === 'week'
    ? `${formatDateRange(weekStart, weekEnd)} · ${weekLabel}`
    : formatDateFull(selected);
  const heading = isToday
    ? '今天'
    : range === 'week'
      ? `${weekLabel}的任务`
      : isYesterday
        ? '昨天完成了什么'
        : isTomorrow
          ? '明天要做什么'
          : `${formatDateShort(selected)}的任务`;

  let summary = '';
  if (isToday) {
    summary = `${todayTasks.filter(t => !t.done).length} 项待办${overdueTasks().length ? ` · ${overdueTasks().length} 项逾期` : ''}`;
  } else if (isPast) {
    summary = dayTasks.length
      ? `${isYesterday ? '昨天' : '这一天'}共 <strong>${dayTasks.length} 项</strong>，已完成 <strong>${doneTasks.length} 项</strong>，预计投入 ${formatHours(totalHours)}。${openTasks.length ? `<span class="date-open">${openTasks.length} 项未完成</span>` : ''}`
      : '这一天没有安排任务。';
  } else {
    summary = dayTasks.length
      ? `${range === 'week' ? weekLabel : isTomorrow ? '明天' : '这一天'}共 <strong>${dayTasks.length} 项</strong>，预计投入 ${formatHours(totalHours)}。`
      : '这一天没有安排任务。';
  }

  const taskSection = (label, tasks, count) => count ? `
    <div class="task-section-label">
      <span>${label}</span>
      <span class="count-badge">${count}</span>
      <span class="line"></span>
    </div>
    ${filterTasks(tasks).map(taskRow).join('')}
  ` : '';

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
    panelTitle = '待办';
    taskBody = taskSection('优先处理', DB.tasks.must, DB.tasks.must.length)
      + taskSection('接下来', DB.tasks.should, DB.tasks.should.length)
      + (DB.tasks.could.length ? taskSection('稍后', DB.tasks.could, DB.tasks.could.length) : '');
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
    <div class="capacity-card">
      <div class="capacity-top">
        <div class="capacity-title">
          今日安排
        </div>
        <div class="capacity-figure">
          <strong>${c.committed}h</strong> / ${c.available}h
          <span class="muted">· 剩余 ${remaining}h</span>
        </div>
      </div>
      <div class="capacity-bar" role="progressbar" aria-label="今日时间占用" aria-valuenow="${committedPct}" aria-valuemin="0" aria-valuemax="100">
        <span class="capacity-seg focus" style="width:${committedPct}%"></span>
      </div>
      <div class="work-schedule">
        <div class="work-schedule-head">
          <span class="ws-title">${icon('clock', 12)} 工作时间 <b>${workHours}</b></span>
          <span class="tiny muted">午休 ${workday.lunch}</span>
          <button class="btn btn-sm btn-ghost ws-edit" data-action="work-hours">${icon('edit', 11)} 调整</button>
        </div>
        ${scheduleRows ? `<details class="schedule-details"><summary>时间安排</summary><div class="time-blocks">${scheduleRows}</div></details>` : ''}
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

    ${isToday && overdueTasks().length ? `
      <div class="overdue-strip">
        ${icon('alert', 15)}
        <span class="title">${overdueTasks().length} 项逾期</span>
        <span class="items">${overdueTasks().map(o => `${esc(o.title)}（${o.days} 天）`).join(' · ')}</span>
        <button class="btn" data-action="overdue">现在处理 ${icon('arrowRight', 12)}</button>
      </div>
    ` : ''}

    <div class="today-grid">
      <div class="today-main">
        <section class="task-panel">
          <div class="panel-head">
            <h3>${icon('target', 15)} ${panelTitle} <span class="count-badge">${dayTasks.length}</span></h3>
            <div class="row gap-6">
              <button class="btn btn-sm btn-ghost" data-action="task-filter">${icon('filter', 12)} ${state.taskFilterProject || state.taskFilterStatus ? '已筛选' : '筛选与排序'}</button>
            </div>
          </div>
          ${taskBody || emptyDay}
          ${dayTasks.length && !filterTasks(dayTasks).length ? '<p class="panel-body muted">没有符合筛选条件的任务</p>' : ''}
        </section>
      </div>

      <aside class="today-rail">
        <button class="rail-command" data-action="impact">${icon('calendar', 16)} 安排临时任务 ${icon('plus', 14)}</button>

        <section class="rail-card">
          <div class="rail-head">
            <h3>${icon('clock', 14)} 等待跟进 <span class="chip">${DB.waiting.length}</span></h3>
            <button class="icon-btn sm" data-action="waiting" aria-label="管理等待事项">${icon('arrowRight', 13)}</button>
          </div>
          <div class="wait-list">${waiting || '<p class="quiet-empty">暂无等待事项</p>'}</div>
        </section>

        ${isToday ? `
          <section class="rail-card">
            <div class="rail-head">
              <h3>${icon('calendar', 14)} 今日会议</h3>
              <span class="tiny muted">${DB.meetings.length} 场</span>
            </div>
            <div class="meeting-list">${meetings || '<p class="quiet-empty">今天没有会议</p>'}</div>
          </section>
        ` : ''}
      </aside>
    </div>
  `;
}

function renderInbox() {
  const item = DB.inbox.find(i => i.id === state.inboxId) || DB.inbox[0];
  if (!item) return `
    <div class="page-head"><div><h1>收件箱</h1></div>
      <div class="head-actions"><button class="btn" data-action="inbox-archive">归档与回收站</button><button class="btn btn-primary" data-action="capture">${icon('plus', 14)} 新捕获</button></div>
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
        <h1>收件箱</h1>
        <p class="sub">${DB.inbox.length} 项待处理</p>
      </div>
      <div class="head-actions">
        <button class="icon-btn" data-action="inbox-archive" title="归档与回收站" aria-label="归档与回收站">${icon('inbox', 17)}</button>
        <button class="btn" data-action="inbox-batch">${icon('inbox', 14)} 批量整理</button>
        <button class="btn btn-primary" data-action="capture">${icon('plus', 14)} 添加</button>
      </div>
    </div>

    <div class="inbox-layout">
      <div class="inbox-list">
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
            <button class="icon-btn btn-danger" style="margin-left:auto" data-action="inbox-delete" data-id="${esc(item.id)}" title="删除事项" aria-label="删除当前收件箱事项">${icon('trash', 15)}</button>
          </div>
          <div class="raw-quote">${esc(item.raw)}</div>
          <div class="raw-foot">
            <span>${esc(item.note)}</span>
          </div>
        </div>

        <div class="card parse-card">
          <div class="parse-head">
            <div class="ai-orb">${icon('sparkles', 16)}</div>
            <div>
              <h2>确认安排</h2>
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
              <label>预计用时</label>
              <input class="input" id="inbox-estimate" value="${esc(item.p50)}">
            </div>
            <div class="field">
              <label>预留用时</label>
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
