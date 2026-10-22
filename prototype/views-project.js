/* Projects portfolio and project detail */

function renderProjects() {
  const tasks = allWorkbenchTasks();
  const attention = DB.projects.filter(p => p.health !== 'green').length;
  const stats = [
    { label: '项目', value: DB.projects.length, foot: '当前项目总数' },
    { label: '需要关注', value: attention, foot: '健康度为关注或风险' },
    { label: '未完成任务', value: tasks.filter(t => !t.done && projectById(t.project)).length, foot: '包含其他日期安排' },
    { label: '已完成任务', value: tasks.filter(t => t.done && projectById(t.project)).length, foot: '已关联项目的任务' }
  ];

  const cards = DB.projects.map(p => `
    <button class="project-card" style="--pc:${p.color}" data-action="project" data-id="${p.id}">
      <div class="pc-top">
        <span class="dot"></span>
        <h3>${esc(p.name)}</h3>
        <span class="health ${p.health}">${healthLabel(p.health)}</span>
      </div>
      <p class="pc-goal">${esc(p.goal)}</p>
      <div class="pc-progress">
        <div class="bar"><span style="width:${p.progress}%"></span></div>
        <span class="pct">${p.progress}%</span>
      </div>
      <div class="pc-meta">
        <span>下个节点 ${esc(p.nextDate)} · ${esc(p.next)}</span>
        <span class="${p.health === 'red' ? 'danger' : p.risks ? 'warn' : ''}">${p.risks ? p.risks + ' 项风险' : '无风险'}</span>
      </div>
      <div class="pc-foot">
        <div class="avatar-stack">${p.members.map(m => avatar(m, 'sm')).join('')}</div>
        <span class="updated">${esc(p.updated)}更新</span>
      </div>
    </button>
  `).join('');

  const rows = DB.projects.map(p => `
    <tr data-project-row="${p.id}">
      <td><button class="btn btn-ghost" data-action="project" data-id="${p.id}">${esc(p.name)}</button></td>
      <td>${esc(p.owner)}</td>
      <td>${esc(p.nextDate)} · ${esc(p.next)}</td>
      <td>${tasks.filter(t => t.project === p.id && !t.done).length}</td>
      <td><div class="row gap-6">
        <button class="icon-btn sm" data-action="edit-project" data-id="${p.id}" title="编辑项目" aria-label="编辑 ${esc(p.name)}">${icon('edit', 14)}</button>
        <button class="icon-btn sm btn-danger" data-action="delete-project" data-id="${p.id}" title="删除项目" aria-label="删除 ${esc(p.name)}">${icon('trash', 14)}</button>
      </div></td>
    </tr>
  `).join('');

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Portfolio · 项目组合</div>
        <h1>项目</h1>
        <p class="sub">${DB.projects.length} 个项目，${attention} 个需要关注。</p>
      </div>
      <div class="head-actions">
        <button class="btn" data-action="project-export">${icon('download', 14)} 导出台账</button>
        <button class="btn btn-primary" data-action="new-project">${icon('plus', 14)} 新建项目</button>
      </div>
    </div>

    <div class="card stat-strip">
      ${stats.map(s => `
        <div class="stat">
          <div class="stat-label">${s.label}</div>
          <div class="stat-value">${s.value}</div>
          <div class="stat-foot">${s.foot}</div>
        </div>
      `).join('')}
    </div>

    <div class="project-grid">${cards || '<p class="muted">暂无项目</p>'}</div>

    <div class="project-register">
      <div class="panel-head">
        <h3>${icon('table', 15)} 项目台账</h3>
      </div>
      <div class="table-scroll">
        <table class="task-table">
          <thead><tr><th>项目</th><th>负责人</th><th>下一节点</th><th>未完成任务</th><th>操作</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">暂无项目</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function detailForProject(p) {
  if (DB.projectDetails[p.id]) return DB.projectDetails[p.id];
  return {
    client: '—',
    period: '未设置',
    team: p.members.length + ' 人',
    healthMetrics: [
      { label: '进度', value: p.progress + '%', sub: '计划 ' + p.planned + '%', trend: (p.progress - p.planned) + '%', tone: p.progress < p.planned ? 'amber' : 'ink' },
      { label: '延期任务', value: '0', sub: '本周', trend: '0', tone: 'ink' },
      { label: '阻塞', value: '0', sub: '平均 0 天', trend: '0', tone: 'ink' },
      { label: '需求变更', value: '0', sub: '未记录', trend: '', tone: 'ink' }
    ],
    milestones: [
      { id: `milestone-${p.id}`, name: p.next, date: p.nextDate, status: p.health === 'red' ? 'risk' : 'open' }
    ],
    risks: [],
    activity: [
      { time: '今天', text: '项目健康度更新为「' + healthLabel(p.health) + '」', tone: p.health === 'red' ? 'red' : p.health === 'amber' ? 'accent' : 'green' }
    ],
    stakeholders: p.members.map(m => ({ name: m.i, role: '项目成员', i: m.i, c: m.c })),
    time: { total: '—', delta: '—', split: [] },
    tasks: [],
    docs: []
  };
}

function deltaClass(tone) {
  if (tone === 'red') return 'bad';
  if (tone === 'amber') return 'warn';
  if (tone === 'green') return 'good';
  return '';
}

function statusClass(s) {
  if (s === '进行中') return 'doing';
  if (s === '阻塞' || s === '逾期') return s === '阻塞' ? 'blocked' : 'overdue';
  if (s === '已完成') return 'done';
  return 'todo';
}

function scoreClass(level) {
  return level === '高' ? 'high' : level === '中' ? 'mid' : 'low';
}

function renderProject() {
  const p = projectById(state.projectId) || DB.projects[0];
  if (!p) return renderProjects();
  const detail = detailForProject(p);
  const liveTasks = allWorkbenchTasks().filter(t => t.project === p.id);
  const projectTasks = liveTasks.map(t => ({
    ...t, status: t.done ? '已完成' : t.blocked ? '阻塞' : t.status === '进行中' ? '进行中' : '待开始'
  }));
  const tab = state.projectTab;
  const notes = projectNotesFor(p.id);

  const tabs = [
    { id: 'overview', label: '概览' },
    { id: 'tasks', label: '任务', count: projectTasks.length },
    { id: 'milestones', label: '里程碑', count: detail.milestones.length },
    { id: 'risks', label: '风险', count: detail.risks.length },
    { id: 'notes', label: '项目表', count: notes.length },
    { id: 'docs', label: '文档', count: detail.docs.length }
  ];

  const healthCells = [
    { label: '进度', value: `${p.progress}%`, sub: `计划 ${p.planned}%`, trend: '', tone: 'ink' },
    { label: '未完成', value: liveTasks.filter(t => !t.done).length, sub: '包含其他日期', trend: '', tone: 'ink' },
    { label: '阻塞', value: liveTasks.filter(t => t.blocked && !t.done).length, sub: '未完成任务', trend: '', tone: 'amber' },
    { label: '风险', value: detail.risks.filter(r => r.status !== 'closed').length, sub: '未关闭', trend: '', tone: 'red' }
  ].map(m => `
    <div class="health-cell">
      <div class="health-label">${esc(m.label)}</div>
      <div class="health-value">
        <strong>${esc(m.value)}</strong>
        <span class="delta ${deltaClass(m.tone)}">${esc(m.trend)}</span>
      </div>
      <div class="health-sub">${esc(m.sub)}</div>
    </div>
  `).join('');

  const milestones = detail.milestones.map(m => `
    <div class="milestone-row">
      <span class="ms-dot ${m.status}"></span>
      <div>
        <div class="ms-name">${esc(m.name)}</div>
        ${m.note ? `<div class="ms-note">${esc(m.note)}</div>` : ''}
      </div>
      <span class="ms-date">${esc(m.date)}</span>
      <button class="icon-btn sm" data-action="record-edit" data-kind="milestone" data-id="${esc(m.id)}" aria-label="编辑里程碑">${icon('edit', 13)}</button>
    </div>
  `).join('');

  const riskRows = detail.risks.map(r => `
    <tr>
      <td>
        <div class="risk-title">${esc(r.title)}</div>
        <div class="risk-action">${esc(r.action)}</div>
      </td>
      <td><span class="score ${scoreClass(r.level)}">${r.score}</span></td>
      <td><span class="chip ${r.level === '高' ? 'red' : r.level === '中' ? 'amber' : 'green'}">${esc(r.level)}</span></td>
      <td class="muted">${esc(r.owner)} ${r.status === 'closed' ? '<span class="chip green">已关闭</span>' : ''}
        <button class="icon-btn sm" data-action="record-edit" data-kind="risk" data-id="${esc(r.id)}" aria-label="编辑风险">${icon('edit', 13)}</button></td>
    </tr>
  `).join('');

  const activity = detail.activity.map(a => `
    <div class="activity-row">
      <span class="activity-time">${esc(a.time)}</span>
      <span class="activity-dot ${a.tone}"></span>
      <span class="activity-text">${esc(a.text)}</span>
    </div>
  `).join('');

  const noteRows = notes.map(n => `
    <tr>
      <td class="note-time">${esc(n.time)}</td>
      <td>
        <div class="note-text">${esc(n.text)}</div>
        ${n.raw && n.raw !== n.text ? `<div class="note-raw">原文：${esc(n.raw)}</div>` : ''}
      </td>
      <td><span class="chip">${esc(n.source || '对话')}</span></td>
      <td class="muted">${esc(n.author || DB.user.name)}</td>
    </tr>
  `).join('');

  const people = detail.stakeholders.map(s => `
    <div class="person-row">
      <span class="avatar sm" style="background:${s.c}">${esc(s.i)}</span>
      <div>
        <div class="person-name">${esc(s.name)}</div>
        <div class="person-role">${esc(s.role)}</div>
      </div>
    </div>
  `).join('');

  const projectTime = DB.timeEntries.filter(e => e.project === p.id && e.date >= startOfWeekISO(DB.meta.today));
  const timeSplit = projectTime.length ? [{ label: '专注计时', value: Math.round(projectTime.reduce((sum, e) => sum + e.seconds / 3600, 0) * 10) / 10, color: p.color }] : [];
  const totalTime = timeSplit.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const stops = timeSplit.map(s => {
    const start = acc;
    acc += s.value / totalTime * 100;
    return `${s.color} ${start}% ${acc}%`;
  }).join(', ');
  const donutStyle = timeSplit.length
    ? `background:conic-gradient(${stops})`
    : 'background:var(--surface-3)';
  const timeLegend = timeSplit.map(s => `
    <span><i style="background:${s.color}"></i>${esc(s.label)} ${s.value}h</span>
  `).join('');

  const docs = detail.docs.map(d => `
    <div class="doc-row">
      <span class="doc-icon">${icon(d.icon === 'table' ? 'table' : 'file', 14)}</span>
      <div class="flex-1">
        <div class="doc-title">${esc(d.title)}</div>
        <div class="doc-meta">${esc(d.meta)}</div>
      </div>
      <button class="icon-btn sm" data-action="document-open" data-id="${esc(d.id)}" aria-label="打开文档 ${esc(d.title)}">${icon('arrowRight', 12)}</button>
    </div>
  `).join('');

  const taskRows = projectTasks.map(t => `
    <tr>
      <td>
        <div class="risk-title">${esc(t.title)}</div>
        <div class="risk-action">${esc(t.estimate)} · ${esc(t.due)}</div>
      </td>
      <td><span class="status-pill ${statusClass(t.status)}">${esc(t.status)}</span></td>
      <td><span class="priority ${t.priority.toLowerCase()}">${t.priority}</span></td>
      <td class="muted">${esc(t.due)} <button class="icon-btn sm" data-action="task-edit" data-id="${esc(t.id)}" aria-label="编辑任务">${icon('edit', 13)}</button></td>
    </tr>
  `).join('');

  let tabContent = '';

  if (tab === 'overview') {
    tabContent = `
      <div class="detail-grid">
        <div class="detail-stack">
          <div class="card">
            <div class="panel-head">
              <h3>${icon('chart', 15)} 健康度</h3>
              <span class="health ${p.health}">${healthLabel(p.health)}</span>
            </div>
            <div class="health-grid">${healthCells}</div>
          </div>

          <div class="card">
            <div class="panel-head">
              <h3>${icon('flag', 15)} 里程碑</h3>
              <button class="btn btn-sm btn-ghost" data-action="project-tab" data-tab="milestones">查看全部 ${icon('arrowRight', 11)}</button>
            </div>
            <div class="panel-body">${milestones}</div>
          </div>

          <div class="card">
            <div class="panel-head">
              <h3>${icon('alert', 15)} 风险 Top 3</h3>
              <button class="btn btn-sm btn-ghost" data-action="project-tab" data-tab="risks">风险登记册 ${icon('arrowRight', 11)}</button>
            </div>
            <table class="risk-table">
              <thead><tr><th>风险</th><th>评分</th><th>等级</th><th>负责人</th></tr></thead>
              <tbody>${riskRows || '<tr><td colspan="4" class="muted">暂无登记风险</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <aside class="detail-rail">
          <div class="card">
            <div class="panel-head"><h3>${icon('route', 14)} 项目脉搏</h3><span class="tiny muted">实时</span></div>
            <div class="panel-body"><div class="activity-list">${activity}</div></div>
          </div>

          <div class="card">
            <div class="panel-head"><h3>${icon('user', 14)} 干系人</h3><span class="tiny muted">${detail.stakeholders.length} 人</span></div>
            <div class="panel-body"><div class="people-list">${people}</div></div>
          </div>

          <div class="card">
            <div class="panel-head"><h3>${icon('pie', 14)} 本周计时</h3><span class="tiny muted">${formatHours(projectTime.reduce((sum, e) => sum + e.seconds / 3600, 0))}</span></div>
            <div class="panel-body">
              <div class="donut-wrap">
                <div class="donut" style="${donutStyle}"></div>
                <div class="donut-legend">${timeLegend || '<span>暂无时间记录</span>'}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="panel-head"><h3>${icon('file', 14)} 最近文档</h3><button class="icon-btn sm" data-action="project-tab" data-tab="docs" aria-label="项目文档">${icon('arrowRight', 12)}</button></div>
            <div class="doc-list">${docs}</div>
          </div>
        </aside>
      </div>
    `;
  } else if (tab === 'tasks') {
    tabContent = `
      <div class="card">
        <div class="panel-head">
          <h3>${icon('layout', 15)} 任务 <span class="count-badge">${projectTasks.length}</span></h3>
          <div class="row gap-6">
            <button class="btn btn-sm" data-action="project-board">${icon('layout', 12)} ${state.projectBoard ? '列表' : '看板'}</button>
            <button class="btn btn-sm btn-primary" data-action="project-task" data-id="${p.id}">${icon('plus', 12)} 新建</button>
          </div>
        </div>
        ${state.projectBoard ? `<div class="task-board">${['待开始', '进行中', '阻塞', '已完成'].map(status => `<section><h3>${status}</h3>
          ${projectTasks.filter(t => t.status === status).map(t => `<button class="board-task" data-action="task-edit" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><span>${esc(t.priority)} · ${esc(t.estimate)}</span></button>`).join('') || '<p class="small muted">暂无任务</p>'}</section>`).join('')}</div>` : `<div class="table-scroll"><table class="task-table">
          <thead><tr><th>任务</th><th>状态</th><th>优先级</th><th>截止</th></tr></thead>
          <tbody>${taskRows || '<tr><td colspan="4" class="muted">暂无任务</td></tr>'}</tbody>
        </table></div>`}
      </div>
    `;
  } else if (tab === 'milestones') {
    tabContent = `
      <div class="detail-grid">
        <div class="card">
          <div class="panel-head"><h3>${icon('flag', 15)} 里程碑</h3><button class="btn btn-sm" data-action="record-edit" data-kind="milestone">${icon('plus', 12)} 新增节点</button></div>
          <div class="panel-body">${milestones}</div>
        </div>
        <aside class="detail-rail">
          <div class="card card-pad">
            <div class="eyebrow">下一步</div>
            <h3 class="mt-8">${esc(p.next)}</h3>
            <p class="small muted mt-8">${esc(p.nextDate)}</p>
            <button class="btn btn-block mt-12" data-action="milestone-follow">${icon('bell', 13)} ${p.followMilestones ? '取消简报关注' : '加入本地简报'}</button>
          </div>
        </aside>
      </div>
    `;
  } else if (tab === 'risks') {
    tabContent = `
      <div class="card">
        <div class="panel-head">
          <h3>${icon('alert', 15)} 风险登记册 <span class="count-badge">${detail.risks.length}</span></h3>
          <button class="btn btn-sm btn-primary" data-action="record-edit" data-kind="risk">${icon('plus', 12)} 新增风险</button>
        </div>
        <table class="risk-table">
          <thead><tr><th>风险</th><th>概率 × 影响</th><th>等级</th><th>负责人</th></tr></thead>
          <tbody>${riskRows || '<tr><td colspan="4" class="muted">暂无登记风险</td></tr>'}</tbody>
        </table>
      </div>
    `;
  } else if (tab === 'notes') {
    tabContent = `
      <div class="card">
        <div class="panel-head">
          <h3>${icon('table', 15)} 项目表 <span class="count-badge">${notes.length}</span></h3>
          <div class="row gap-6">
            <span class="chip green">${icon('sparkles', 10)} 自动润色</span>
            <button class="btn btn-sm" data-action="chat-with-project" data-id="${p.id}">${icon('message', 12)} 用对话记录</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="risk-table note-table">
            <thead><tr><th>时间</th><th>记录</th><th>来源</th><th>记录人</th></tr></thead>
            <tbody>${noteRows || '<tr><td colspan="4" class="muted">还没有记录。在对话里描述项目进展，会自动润色并写入这里。</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    tabContent = `
      <div class="card">
        <div class="panel-head"><h3>${icon('file', 15)} 文档与产出</h3><button class="btn btn-sm" data-action="document-upload">${icon('upload', 12)} 上传文档</button></div>
        <div class="doc-list">${docs || '<div class="panel-body muted small">暂无文档</div>'}</div>
      </div>
    `;
  }

  return `
    <button class="back-link" data-action="nav" data-view="projects">${icon('arrowLeft', 12)} 返回项目</button>

    <div class="detail-head">
      <div>
        <div class="row gap-8">
          <span class="health ${p.health}">${healthLabel(p.health)}</span>
          <span class="chip outline">${esc(p.code)}</span>
          <span class="chip">${p.progress}% 完成</span>
        </div>
        <h1 class="mt-8">${esc(p.name)}</h1>
        <p class="detail-goal">${esc(p.goal)}</p>
        <div class="detail-meta">
          <span>客户 <b>${esc(detail.client)}</b></span>
          <span>周期 <b>${esc(detail.period)}</b></span>
          <span>负责人 <b>${esc(p.owner)}</b></span>
          <span>团队 <b>${esc(detail.team)}</b></span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-danger" data-action="delete-project" data-id="${p.id}">${icon('trash', 13)} 删除</button>
        <button class="btn" data-action="edit-project" data-id="${p.id}">${icon('edit', 13)} 编辑</button>
        <button class="btn btn-primary" data-action="project-task" data-id="${p.id}">${icon('plus', 13)} 新建任务</button>
      </div>
    </div>

    <div class="detail-tabs">
      ${tabs.map(t => `
        <button class="detail-tab ${tab === t.id ? 'active' : ''}" data-action="project-tab" data-tab="${t.id}">
          ${t.label}${t.count != null ? ` <span class="count-badge">${t.count}</span>` : ''}
        </button>
      `).join('')}
    </div>

    ${tabContent}
  `;
}
