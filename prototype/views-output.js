/* Reports, profile and data views */

function reportDateISOFrom(iso) {
  const s = String(iso || state.reportDate || DB.meta.today);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : DB.meta.today;
}

function reportDateISO() {
  return reportDateISOFrom(state.reportDate);
}

function isoWeekNumber(iso) {
  const d = parseISODate(iso);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

function reportPeriodFor(key, iso) {
  const date = reportDateISOFrom(iso);
  const d = parseISODate(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const pad = n => String(n).padStart(2, '0');
  const md = `${m} 月 ${d.getDate()} 日`;

  if (key === 'daily') {
    return {
      key, date, start: date, end: date,
      rangeLabel: `${y}.${pad(m)}.${pad(d.getDate())}`,
      badge: `${md} · ${weekdayCN(date)}`,
      templateMeta: date === DB.meta.today ? '今天' : `${m}/${d.getDate()}`,
      title: `${md}工作日报`,
      eyebrow: `DAILY REPORT · ${y}.${pad(m)}.${pad(d.getDate())}`
    };
  }

  if (key === 'weekly') {
    const start = startOfWeekISO(date);
    const end = addDaysISO(start, 6);
    const s = parseISODate(start);
    const e = parseISODate(end);
    const week = isoWeekNumber(start);
    const endPart = s.getFullYear() === e.getFullYear()
      ? `${pad(e.getMonth() + 1)}.${pad(e.getDate())}`
      : `${e.getFullYear()}.${pad(e.getMonth() + 1)}.${pad(e.getDate())}`;
    return {
      key, date, start, end, week,
      rangeLabel: `${s.getFullYear()}.${pad(s.getMonth() + 1)}.${pad(s.getDate())} – ${endPart}`,
      badge: `W${week} · ${formatDateRange(start, end)}`,
      templateMeta: `W${week}`,
      title: `项目组合 · W${week} 周报`,
      eyebrow: `WEEKLY REPORT · W${week}`
    };
  }

  const start = `${y}-${pad(m)}-01`;
  const end = toISODate(new Date(y, m, 0));
  return {
    key, date, start, end, monthKey: `${y}-${pad(m)}`,
    rangeLabel: `${y}.${pad(m)}.01 – ${pad(m)}.${pad(parseISODate(end).getDate())}`,
    badge: `${y} 年 ${m} 月`,
    templateMeta: `${m} 月`,
    title: `${m} 月项目月报`,
    eyebrow: `MONTHLY REPORT · ${y}.${pad(m)}`
  };
}

function withReportPeriod(report, period) {
  return Object.assign({}, report, {
    period: period.rangeLabel,
    periodBadge: period.badge,
    eyebrow: period.eyebrow
  });
}

function emptyReport(period, key) {
  const unit = key === 'daily' ? '日期' : key === 'weekly' ? '周' : '月';
  return {
    label: key === 'daily' ? '日报' : key === 'weekly' ? '周报' : '月报',
    title: period.title,
    period: period.rangeLabel,
    periodBadge: period.badge,
    eyebrow: period.eyebrow,
    facts: 0,
    empty: true,
    blocks: [
      { type: 'lead', text: `这个${unit}还没有报表记录。可以切换日期查看其他时间段。` },
      { type: 'callout', text: '报表只基于已发生的任务与时间记录生成；没有事实时不会编造内容。' }
    ]
  };
}

function buildReportFromTasks(key, period) {
  const tasks = key === 'daily'
    ? tasksOnDate(period.date)
    : tasksInRange(period.start, period.end);
  if (!tasks.length) return emptyReport(period, key);

  const done = tasks.filter(t => t.done);
  const open = tasks.filter(t => !t.done);
  const overdue = tasks.filter(t => t.overdue);
  const projectLabel = t => {
    const p = projectById(t.project);
    return p ? p.name : '未归属';
  };
  const taskLine = t => `${t.title}（${projectLabel(t)} · ${t.estimate || '待估'}）`;
  const blocks = [];
  const unitLabel = key === 'daily' ? '这一天' : key === 'weekly' ? '这一周' : '这个月';

  blocks.push({
    type: 'lead',
    text: `${unitLabel}共记录 ${tasks.length} 项任务，完成 ${done.length} 项，待推进 ${open.length} 项${overdue.length ? `，逾期 ${overdue.length} 项` : ''}。`
  });
  if (done.length) {
    blocks.push({ type: 'h', text: key === 'daily' ? '当日完成' : key === 'weekly' ? '本周完成' : '本月完成' });
    blocks.push({ type: 'list', items: done.map(taskLine) });
  }
  if (open.length) {
    blocks.push({ type: 'h', text: key === 'daily' ? '当日待推进' : '进行中 / 待推进' });
    blocks.push({ type: 'list', items: open.map(taskLine) });
  }
  if (overdue.length) {
    blocks.push({ type: 'h', text: '逾期' });
    blocks.push({ type: 'list', items: overdue.map(t => `${t.title}（原截止 ${t.due || '未记录'}）`) });
  }
  blocks.push({ type: 'callout', text: '这份报表由任务记录自动汇总；补充记录后可重新生成。' });

  return {
    label: key === 'daily' ? '日报' : key === 'weekly' ? '周报' : '月报',
    title: period.title,
    period: period.rangeLabel,
    periodBadge: period.badge,
    eyebrow: period.eyebrow,
    facts: tasks.length,
    blocks
  };
}

function getReport(key, iso) {
  const date = reportDateISOFrom(iso);

  if (['daily', 'weekly', 'monthly'].includes(key)) {
    const period = reportPeriodFor(key, date);
    return buildReportFromTasks(key, period);
  }
  return factualProjectReport(['project', 'risk', 'requirements'].includes(key) ? key : 'project', date);
}

function renderReportBlock(b) {
  if (b.type === 'lead') return `<p class="report-lead">${esc(b.text)}</p>`;
  if (b.type === 'h') return `<h2 class="report-h">${esc(b.text)}</h2>`;
  if (b.type === 'list') {
    return `<ul class="report-list">${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  if (b.type === 'callout') return `<div class="report-callout">${esc(b.text)}</div>`;
  if (b.type === 'table') {
    return `
      <table class="report-table">
        <thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `;
  }
  return '';
}

function reportShareLink() {
  const base = (typeof location !== 'undefined' && location.origin && location.origin !== 'null')
    ? `${location.origin}${location.pathname}`
    : '';
  const params = new URLSearchParams();
  params.set('report', state.report);
  if (['daily', 'weekly', 'monthly'].includes(state.report)) params.set('date', reportDateISO());
  return `${base}?${params.toString()}`;
}

function reportTemplateMeta(id) {
  return ['daily', 'weekly', 'monthly'].includes(id)
    ? reportPeriodFor(id, reportDateISO()).templateMeta
    : '';
}

function renderReports() {
  const reportDate = reportDateISO();
  const showReportDate = ['daily', 'weekly', 'monthly'].includes(state.report);
  const templates = [
    { id: 'daily', label: '日报', icon: 'file', meta: reportTemplateMeta('daily') },
    { id: 'weekly', label: '周报', icon: 'chart', meta: reportTemplateMeta('weekly') },
    { id: 'monthly', label: '月报', icon: 'calendar', meta: reportTemplateMeta('monthly') },
    { id: 'project', label: '项目状态', icon: 'target', meta: '' },
    { id: 'risk', label: '风险分析', icon: 'alert', meta: '' },
    { id: 'requirements', label: '需求清单', icon: 'table', meta: '' }
  ];

  const r = currentReport();
  const body = r.blocks.map(renderReportBlock).join('');
  const eyebrow = r.eyebrow || (state.report === 'project' ? 'PROJECT STATUS'
    : state.report === 'risk' ? 'RISK ANALYSIS'
    : state.report === 'requirements' ? 'REQUIREMENTS' : 'REPORT');

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Reports · 事实驱动</div>
        <h1>报表</h1>
        <p class="sub">根据本地任务、项目和风险记录汇总。</p>
      </div>
      <div class="head-actions">
        <button class="btn" data-action="report-copy">${icon('message', 14)} 复制 IM 版本</button>
        <button class="btn btn-primary" data-action="report-regenerate">${icon('refresh', 14)} 重新生成</button>
      </div>
    </div>

    <div class="reports-layout">
      <aside class="card template-list">
        <div class="template-head">
          <div class="eyebrow">模板</div>
        </div>
        ${templates.map(t => `
          <button class="template-item ${state.report === t.id ? 'active' : ''}" data-action="report" data-report="${t.id}">
            <span class="template-icon">${icon(t.icon, 13)}</span>
            ${t.label}
            <span class="tmeta">${t.meta}</span>
          </button>
        `).join('')}
      </aside>

      <div class="report-center">
        <div class="report-toolbar">
          <div class="left">
            <span class="chip ${r.facts ? 'green' : 'outline'}">${icon('shield', 11)} 已汇总 ${r.facts} 条事实</span>
            ${showReportDate ? `
              <label class="report-date-field" for="report-date" title="选择报表日期">
                <span class="report-period-label">${esc(r.periodBadge || r.period)}</span>
                ${icon('chevronDown', 12)}
                <input type="date" id="report-date" value="${esc(reportDate)}" max="${DB.meta.today}" aria-label="选择报表日期">
              </label>
            ` : ''}
          </div>
          <div class="right">
            ${!showReportDate ? `<select class="select" id="report-project" aria-label="报表项目">
              <option value="">全部项目</option>${DB.projects.map(p => `<option value="${p.id}" ${state.reportProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
            <button class="btn btn-sm btn-ghost" data-action="report-edit">${icon('edit', 12)} 编辑</button>
            <button class="btn btn-sm" data-action="report-save">${icon('check', 12)} 保存</button>
            <select class="select" id="report-export-format" aria-label="导出格式">
              ${['md', 'docx', 'xlsx', 'pdf'].map(format => `<option value="${format}"
                ${format !== 'md' && !window.xiaoyuDesktop?.exportFile ? 'disabled' : ''}>${format === 'md' ? 'Markdown' : format.toUpperCase()}</option>`).join('')}
            </select>
            <button class="icon-btn" data-action="report-export" title="导出报表" aria-label="导出报表">${icon('download', 15)}</button>
          </div>
        </div>

        <article class="report-sheet">
          <div class="eyebrow">${esc(eyebrow)}</div>
          <h1>${esc(r.title)}</h1>
          <div class="report-meta">
            <span>${esc(r.period)}</span>
            <span class="sep">·</span>
            <span>${esc(DB.user.name)}</span>
            <span class="sep">·</span>
            <span>${r.edited ? '已人工编辑' : '本地汇总'}</span>
            <span class="sep">·</span>
            <span>${r.facts} 条事实来源</span>
          </div>
          <div class="report-body">${body}</div>
          <div class="report-foot">
            ${icon('sparkles', 11)}
            <span>${DB.reportSnapshots[reportSnapshotKey()] ? '已保存快照' : '当前记录'} · ${r.facts} 条来源</span>
            <span class="spacer"></span>
            <span>本地汇总</span>
          </div>
        </article>
      </div>

      <aside class="report-rail">
        <div class="card">
          <div class="rail-section-title">汇总方式</div>
          <p class="small muted">本地记录汇总；人工编辑后可保存快照。</p>
        </div>

        <div class="card">
          <div class="rail-section-title">生成设置</div>
          <div class="setting-row"><span>周期</span><span class="val">${esc(r.period)}</span></div>
          <div class="setting-row"><span>来源记录</span><span class="val">${r.facts}</span></div>
          <div class="setting-row"><span>云端分享</span><span class="val">尚未接入</span></div>
        </div>

        <div class="card">
          <div class="rail-section-title">事实完整性</div>
          <div class="fact-integrity">
            ${icon('shield', 14)}
            <div><strong>${r.edited ? '包含人工编辑内容' : '根据已保存记录汇总'}</strong><br>${r.edited ? '编辑内容需自行核对。' : '示例项目仍属于本机记录，可编辑或删除。'}</div>
          </div>
          <div class="fact-list">
            <span><i></i>本机任务 ${allWorkbenchTasks().length} 条</span>
            <span><i></i>项目 ${DB.projects.length} 个</span>
          </div>
        </div>

      </aside>
    </div>
  `;
}

function radarChart(data) {
  const cx = 160, cy = 134, r = 86, n = data.length;
  const angle = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, scale) => [cx + Math.cos(angle(i)) * r * scale, cy + Math.sin(angle(i)) * r * scale];
  const rings = [0.25, 0.5, 0.75, 1].map(s =>
    `<polygon points="${data.map((_, i) => pt(i, s).join(',')).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1"/>`
  ).join('');
  const axes = data.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`;
  }).join('');
  const poly = data.map((d, i) => pt(i, d.value / 100).join(',')).join(' ');
  const dots = data.map((d, i) => {
    const [x, y] = pt(i, d.value / 100);
    return `<circle cx="${x}" cy="${y}" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/>`;
  }).join('');
  const labels = data.map((d, i) => {
    const [x, y] = pt(i, 1.26);
    const anchor = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text x="${x}" y="${y + 3}" text-anchor="${anchor}" font-size="9.5" fill="var(--ink-3)">${esc(d.label)}</text>`;
  }).join('');

  return `
    <svg viewBox="0 0 320 272" width="100%" style="max-width:320px" role="img" aria-label="工作方式雷达图">
      ${rings}${axes}
      <polygon points="${poly}" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.8"/>
      ${dots}${labels}
    </svg>
  `;
}

function trendChart(values) {
  const w = 360, h = 124, padX = 12, padY = 14;
  const min = 60, max = 90;
  const x = i => padX + i * (w - padX * 2) / (values.length - 1);
  const y = v => h - padY - (v - min) / (max - min) * (h - padY * 2);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1)},${h - padY} L${x(0)},${h - padY} Z`;
  const grid = [60, 70, 80, 90].map(v => `
    <line x1="${padX}" y1="${y(v)}" x2="${w - padX}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>
    <text x="${padX}" y="${y(v) - 4}" font-size="7.5" fill="var(--ink-3)">${v}%</text>
  `).join('');
  const labels = values.map((_, i) => `<text x="${x(i)}" y="${h - 2}" text-anchor="middle" font-size="7.5" fill="var(--ink-3)">W${36 + i}</text>`).join('');
  const lastX = x(values.length - 1), lastY = y(values[values.length - 1]);

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="按时完成率趋势">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#trendFill)"/>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
      ${labels}
    </svg>
  `;
}

function renderProfile() {
  return renderFactualProfile();
}

function renderData() {
  const connectorGroups = [
    { id: 'content', title: '内容与沟通', icon: 'message', sub: '聊天、邮件、会议里的承诺，先进收件箱。' },
    { id: 'work', title: '工作系统', icon: 'layout', sub: '项目、表格、代码库里的任务与状态。' },
    { id: 'plugin', title: '插件与扩展', icon: 'zap', sub: '把捕获入口放到你已经在用的地方。' }
  ];

  const connectorCard = c => {
    const status = integrationStatus(c.id);
    return `
    <button class="connector-card" data-action="connector-config" data-id="${c.id}" aria-label="${esc(c.name)}连接配置"
      ${!INTEGRATIONS[c.id] && c.id !== 'manual' ? 'disabled title="此连接器尚未接入"' : ''}>
      <div class="connector-top">
        <span class="connector-mark" style="background:${c.color}">${esc(c.mark)}</span>
        <div>
          <div class="connector-name">${esc(c.name)}</div>
          <div class="connector-meta">${esc(status.meta)}</div>
        </div>
        <span class="connector-status ${status.on ? 'on' : 'off'}"></span>
      </div>
      <div class="connector-foot">
        <span>${esc(status.label)}</span>
        <span class="link">${c.id === 'manual' ? '打开' : INTEGRATIONS[c.id] ? '配置' : '待开发'}</span>
      </div>
    </button>
  `; };

  const connectorSections = connectorGroups.map(g => {
    const items = DB.connectors.filter(c => c.group === g.id);
    const connected = items.filter(c => integrationStatus(c.id).on).length;
    return `
      <div class="connector-section">
        <div class="connector-section-head">
          <div>
            <h3>${icon(g.icon, 14)} ${g.title}</h3>
            <p>${g.sub}</p>
          </div>
          <span class="tiny muted">${connected} / ${items.length} 已验证或可用</span>
        </div>
        <div class="connector-grid">${items.map(connectorCard).join('')}</div>
      </div>
    `;
  }).join('');

  const workflow = DB.workflow;
  const workflowRules = workflow.rules.map(r => `
    <div class="workflow-rule">
      <span class="wr-icon">${icon(r.icon, 12)}</span>
      <div>
        <div class="wr-title">${esc(r.title)}</div>
        <div class="wr-text">${esc(r.text)}</div>
      </div>
    </div>
  `).join('');

  const fields = DB.fields[state.fieldsTab] || DB.fields.task;
  const fieldTabs = [
    { id: 'task', label: '任务' },
    { id: 'project', label: '项目' },
    { id: 'risk', label: '风险' },
    { id: 'person', label: '人员' }
  ];

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Data · 可扩展的数据层</div>
        <h1>数据与集成</h1>
        <p class="sub">管理外部来源、连接配置与手动同步记录。</p>
      </div>
      <div class="head-actions">
        <span class="data-head-badge">${icon('shield', 12)} 本地存储</span>
        <button class="btn btn-primary" data-action="connector-add">${icon('plus', 14)} 配置连接器</button>
      </div>
    </div>

    <div class="section-title-row" style="margin-top:0">
      <div>
        <h2>连接器</h2>
        <p class="sub">${DB.connectors.filter(c => integrationStatus(c.id).on).length} 个已验证或可用 · ${Object.keys(INTEGRATIONS).length} 类可配置。外部记录同步后进入收件箱。</p>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-ghost" data-action="connector-logs">${icon('refresh', 12)} 同步日志</button>
      </div>
    </div>

    ${connectorSections}

    <div class="section-title-row">
      <div>
        <h2>我的工作流</h2>
        <p class="sub">记录工作约定并提取规则草稿，自动执行尚未接入。</p>
      </div>
      <span class="chip green" id="workflow-version">v${workflow.version} · ${workflow.updated}</span>
    </div>

    <div class="card workflow-card">
      <div class="workflow-grid">
        <div class="workflow-editor">
          <div class="wf-label">${icon('edit', 13)} 你怎么工作？</div>
          <textarea id="workflow-input" class="workflow-input" placeholder="例如：老板在飞书派活时，先判断是不是星火项目；今天排不下，先给我看会挤掉什么……">${esc(workflow.text)}</textarea>
          <div class="workflow-hint">自然语言即可。建议包含：触发条件、归属规则、截止口径、冲突处理、提醒时间。</div>
          <div class="workflow-actions">
            <button class="btn btn-primary btn-sm" data-action="parse-workflow">${icon('sparkles', 12)} 提取规则草稿</button>
            <button class="btn btn-sm" data-action="workflow-template" data-template="boss">老板派活</button>
            <button class="btn btn-sm" data-action="workflow-template" data-template="meeting">会议行动项</button>
            <button class="btn btn-sm" data-action="workflow-template" data-template="client">客户邮件</button>
            <button class="btn btn-sm btn-ghost" data-action="save-workflow">${icon('check', 12)} 保存</button>
          </div>
        </div>
        <div class="workflow-rules-box">
          <div class="workflow-rules-head">
            <span>规则草稿</span>
            <span class="chip green">${workflow.rules.length} 条</span>
          </div>
          <div class="workflow-rules" id="workflow-rules">${workflowRules}</div>
          <div class="workflow-rules-foot">${icon('shield', 11)} 仅保存规划；不会启动外部监听或定时提醒</div>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="panel-head">
        <h3>${icon('route', 15)} 数据如何流动</h3>
        <span class="chip green">原始数据保存在本机</span>
      </div>
      <div class="panel-body">
        <div class="pipeline">
          <span class="pipe-node"><b>来源</b><small>飞书 / 邮件 / ICS</small></span>
          ${icon('arrowRight', 14)}
          <span class="pipe-node"><b>原始数据</b><small>source_item</small></span>
          ${icon('arrowRight', 14)}
          <span class="pipe-node"><b>字段映射</b><small>可配置</small></span>
          ${icon('arrowRight', 14)}
          <span class="pipe-node"><b>任务 / 项目</b><small>核心实体</small></span>
          ${icon('arrowRight', 14)}
          <span class="pipe-node"><b>指标 / 报告</b><small>可下钻</small></span>
        </div>
        <p class="small muted mt-12">同一条数据可以同时进入多个视图：今天、项目、周报、画像。删除实体不会删除原始数据，反之亦然。</p>
      </div>
    </div>

    <div class="section-title-row">
      <div>
        <h2>自定义数据模型</h2>
        <p class="sub">管理字段定义；任务、项目和风险可在编辑时填写自定义字段。</p>
      </div>
      <button class="btn btn-sm" data-action="record-edit" data-kind="field">${icon('plus', 12)} 新增字段</button>
    </div>

    <div class="card">
      <div class="fields-tabs">
        ${fieldTabs.map(t => `<button class="fields-tab ${state.fieldsTab === t.id ? 'active' : ''}" data-action="fields-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <table class="fields-table">
        <thead><tr><th>字段</th><th>类型</th><th>用途</th><th>状态</th><th></th></tr></thead>
        <tbody>
          ${fields.map(f => `
            <tr>
              <td class="strong">${esc(f.name)}</td>
              <td><span class="field-type">${esc(f.type)}</span></td>
              <td class="muted">${esc(f.use)}</td>
              <td><span class="field-status ${f.status === '系统' ? 'sys' : ''}">${esc(f.status)}</span></td>
              <td style="text-align:right"><button class="icon-btn sm" data-action="record-edit" data-kind="field" data-id="${esc(f.id)}" aria-label="编辑字段 ${esc(f.name)}">${icon('settings', 12)}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title-row">
      <div>
        <h2>数据健康</h2>
        <p class="sub">本地优先，但备份和可迁移性不能省。</p>
      </div>
      <div class="actions">
        <button class="btn btn-sm" data-action="data-backup">${icon('shield', 12)} 立即备份</button>
        <button class="btn btn-sm" data-action="data-export">${icon('download', 12)} 导出工作数据</button>
      </div>
    </div>

    <div class="card data-health">
      <div class="dh-cell">
        <div class="dh-label">记录</div>
        <div class="dh-value">${allWorkbenchTasks().length + DB.projects.length + DB.inbox.length} <small>条</small></div>
        <div class="dh-foot">任务 / 项目 / 事件</div>
      </div>
      <div class="dh-cell">
        <div class="dh-label">事件</div>
        <div class="dh-value">${(DB.sourceItems || []).length} <small>条</small></div>
        <div class="dh-foot">已保留的来源原文</div>
      </div>
      <div class="dh-cell">
        <div class="dh-label">存储</div>
        <div class="dh-value">${Math.ceil(new Blob([JSON.stringify(exportableSnapshot())]).size / 1024)} <small>KB</small></div>
        <div class="dh-foot">工作数据导出大小 · 不含凭据</div>
      </div>
      <div class="dh-cell">
        <div class="dh-label">上次备份</div>
        <div class="dh-value" style="font-size:14px">${DB.meta.lastBackup ? esc(new Date(DB.meta.lastBackup).toLocaleString('zh-CN')) : '尚未备份'}</div>
        <div class="dh-foot">手动保存到所选位置</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="panel-head"><h3>${icon('lock', 15)} 本地数据与模型</h3></div>
      <div class="panel-body">
        <div class="setting-row"><span>润色供应商</span><span class="val">${esc(aiProviderName())}</span></div>
        <div class="setting-row"><span>工作数据导出</span><span class="val">不含连接凭据和供应商设置</span></div>
        <div class="setting-row"><span>桌面数据库备份</span><span class="val">凭据保持系统加密</span></div>
        <div class="setting-row"><span>自动脱敏 / 云端同步</span><span class="val">尚未接入</span></div>
      </div>
    </div>
  `;
}
