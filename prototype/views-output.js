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
    facts: tasks.length + overdue.length,
    blocks
  };
}

function getReport(key, iso) {
  const date = reportDateISOFrom(iso);

  if (['daily', 'weekly', 'monthly'].includes(key)) {
    const period = reportPeriodFor(key, date);
    if (key === 'daily') return buildReportFromTasks(key, period);
    if (key === 'weekly' && period.start === '2026-10-19') return withReportPeriod(DB.reports.weekly, period);
    if (key === 'monthly' && period.monthKey === '2026-10') return withReportPeriod(DB.reports.monthly, period);

    const historyKey = key === 'daily' ? date : key === 'weekly' ? period.start : period.monthKey;
    const history = DB.reportHistory && DB.reportHistory[key] && DB.reportHistory[key][historyKey];
    if (history) return withReportPeriod(history, period);
    return buildReportFromTasks(key, period);
  }

  const d = DB.projectDetails.p1;

  if (key === 'project') {
    return {
      label: '项目状态', title: '星火项目 · 状态报告', period: '2026.10.21', facts: 12,
      blocks: [
        { type: 'lead', text: '项目当前处于「关注」状态。整体进度 62%，落后计划 8 个百分点；测试库延迟是唯一的高风险项，但已有备用方案。' },
        { type: 'h', text: '健康度' },
        { type: 'list', items: [
          '进度 62%，计划 70%，差距主要来自测试库延迟与品牌评审占用。',
          '延期任务 3 个，其中 1 个已升级为风险。',
          '阻塞 2 个，平均阻塞 3.5 天。',
          '本月需求变更 4 次，范围仍在可控区间。'
        ] },
        { type: 'h', text: '本周关键进展' },
        { type: 'list', items: [
          '完成联调环境自测，覆盖 12 个核心接口。',
          '客户演示脚本 v0.3 已发出，等待张经理确认。',
          '演示环境部署完成 60%，依赖运维开通测试库。'
        ] },
        { type: 'h', text: '风险与阻塞' },
        { type: 'list', items: [
          '测试库开通延迟 5 天（概率 4 × 影响 4），已升级至王总。',
          '演示脚本未确认（3 × 4），若周五无反馈将影响演示内容。'
        ] },
        { type: 'callout', text: '需要决策：若周三 12:00 前测试库仍不可用，建议启用备用环境，演示范围缩小到 3 个核心场景。' }
      ]
    };
  }

  if (key === 'risk') {
    return {
      label: '风险分析', title: '项目组合 · 风险分析', period: '第 43 周', facts: 24,
      blocks: [
        { type: 'lead', text: '本周扫描 6 个项目、12 个里程碑，识别出 4 个需要处理的风险，其中 1 个为高等级。' },
        { type: 'h', text: '高风险' },
        { type: 'list', items: [
          '星火项目 · 测试库开通延迟：概率 4 × 影响 4，已阻塞 5 天，直接影响 10/28 客户演示。',
          '品牌升级 · 主视觉未定稿：进度落后计划 17%，法务商标风险尚未闭环。'
        ] },
        { type: 'h', text: '需要关注' },
        { type: 'list', items: [
          '客户成功中台 · 灰度名单扩大至 30%，容量与客服压力未评估。',
          'Q4 招聘 · 二面安排延迟，可能影响 11 月到岗。'
        ] },
        { type: 'h', text: '建议动作' },
        { type: 'list', items: [
          '今天 12:00 前拿到测试库开通的明确时间，否则启用备用环境。',
          '周五前完成品牌主视觉定稿，法务同步出商标风险结论。',
          '把「灰度名单评估」拆成 1 页纸，先给结论再补细节。'
        ] },
        { type: 'callout', text: '本周风险趋势：新增 2 个，关闭 1 个，净增 1 个。主要来源是外部依赖，不是执行问题。' }
      ]
    };
  }

  if (key === 'requirements') {
    return {
      label: '需求清单', title: '需求清单 · 星火项目', period: '2026.10.21', facts: 9,
      blocks: [
        { type: 'lead', text: '当前收集到 9 条需求，其中 3 条待确认、4 条已排期、2 条建议延后。以下为需要你确认的条目。' },
        { type: 'h', text: '待确认' },
        { type: 'table', head: ['需求', '来源', '优先级', '预估', '状态'], rows: [
          ['演示环境支持双屏', '张经理', 'P1', '4h', '待确认'],
          ['联调问题按模块导出', '王总', 'P2', '3h', '待确认'],
          ['官网首屏同步改版', '品牌评审会', 'P2', '8h', '待确认']
        ] },
        { type: 'h', text: '已排期' },
        { type: 'table', head: ['需求', '来源', '优先级', '预估', '状态'], rows: [
          ['灰度名单扩大至 30%', '客户邮件', 'P2', '1.5h', '本周'],
          ['SSO 登录接入', '内部工具链', 'P2', '6h', '周四'],
          ['验收清单补充边界场景', '李维', 'P2', '1h', '逾期']
        ] },
        { type: 'callout', text: '建议：把「官网首屏同步改版」拆成独立项目，否则会持续挤占星火演示准备时间。' }
      ]
    };
  }

  return DB.reports.weekly;
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
    : 'https://xiaoyu.local/';
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
    { id: 'project', label: '项目状态', icon: 'target', meta: '星火' },
    { id: 'risk', label: '风险分析', icon: 'alert', meta: '4 项' },
    { id: 'requirements', label: '需求清单', icon: 'table', meta: '9 条' }
  ];

  const r = getReport(state.report, reportDate);
  const body = r.blocks.map(renderReportBlock).join('');
  const eyebrow = r.eyebrow || (state.report === 'project' ? 'PROJECT STATUS'
    : state.report === 'risk' ? 'RISK ANALYSIS'
    : state.report === 'requirements' ? 'REQUIREMENTS' : 'REPORT');

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Reports · 事实驱动</div>
        <h1>报表</h1>
        <p class="sub">SQL 先算事实，AI 只负责写叙述。每条结论都能回到任务。</p>
      </div>
      <div class="head-actions">
        <button class="btn" data-action="toast" data-msg="已复制为 IM 纯文本">${icon('message', 14)} 复制 IM 版本</button>
        <button class="btn btn-primary" data-action="toast" data-msg="正在重新生成…（演示）">${icon('refresh', 14)} 重新生成</button>
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
            <div class="report-copy-field">
              <input class="input" id="report-share-link" readonly value="${esc(reportShareLink())}" aria-label="报告分享链接">
              <button class="icon-btn sm" data-action="copy-report-link" aria-label="复制报告链接" title="复制报告链接">${icon('copy', 12)}</button>
            </div>
            <button class="btn btn-sm btn-ghost" data-action="toast" data-msg="编辑模式（演示）">${icon('edit', 12)} 编辑</button>
            <button class="btn btn-sm" data-action="toast" data-msg="已保存快照">${icon('check', 12)} 保存</button>
          </div>
        </div>

        <article class="report-sheet">
          <div class="eyebrow">${esc(eyebrow)}</div>
          <h1>${esc(r.title)}</h1>
          <div class="report-meta">
            <span>${esc(r.period)}</span>
            <span class="sep">·</span>
            <span>李维</span>
            <span class="sep">·</span>
            <span>生成于 ${DB.meta.now}</span>
            <span class="sep">·</span>
            <span>${r.facts} 条事实来源</span>
          </div>
          <div class="report-body">${body}</div>
          <div class="report-foot">
            ${icon('sparkles', 11)}
            <span>由${esc(assistantName())}基于 ${r.facts} 条事实生成</span>
            <span class="spacer"></span>
            <span>模型：按设置 · 每条结论可回溯</span>
          </div>
        </article>
      </div>

      <aside class="report-rail">
        <div class="card">
          <div class="rail-section-title">生成模型</div>
          <div class="model-pick">
            <div class="model-option active">
              <span class="m-dot"></span>
              <span class="m-name">DeepSeek</span>
              <span class="m-sub">默认</span>
            </div>
            <div class="model-option">
              <span class="m-dot" style="background:var(--violet)"></span>
              <span class="m-name">OpenAI</span>
              <span class="m-sub">备用</span>
            </div>
            <div class="model-option">
              <span class="m-dot" style="background:var(--ink-3)"></span>
              <span class="m-name">Ollama</span>
              <span class="m-sub">本地</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="rail-section-title">生成设置</div>
          <div class="setting-row"><span>范围</span><span class="val">本周 / 星火</span></div>
          <div class="setting-row"><span>语气</span><span class="val">简洁 · 结论先行</span></div>
          <div class="setting-row"><span>脱敏</span><span class="val">客户名 → 客户 A</span></div>
          <div class="setting-row"><span>引用任务 ID</span><span class="val" style="color:var(--green)">已开启</span></div>
        </div>

        <div class="card">
          <div class="rail-section-title">事实完整性</div>
          <div class="fact-integrity">
            ${icon('shield', 14)}
            <div><strong>未发现无来源结论</strong><br>所有数字均来自本地事件表，可下钻。</div>
          </div>
          <div class="fact-list">
            <span><i></i>完成任务 3 条</span>
            <span><i></i>进行中 2 条</span>
            <span><i></i>风险 2 条</span>
            <span><i></i>时间记录 18.5h</span>
          </div>
        </div>

        <div class="card">
          <div class="rail-section-title">导出</div>
          <div class="export-grid">
            <button class="export-btn" data-action="toast" data-msg="导出 Markdown（演示）">${icon('download', 12)} Markdown</button>
            <button class="export-btn" data-action="toast" data-msg="导出 DOCX（演示）">${icon('file', 12)} DOCX</button>
            <button class="export-btn" data-action="toast" data-msg="导出 XLSX（演示）">${icon('table', 12)} XLSX</button>
            <button class="export-btn" data-action="toast" data-msg="导出 PDF（演示）">${icon('download', 12)} PDF</button>
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
  const p = DB.profile;
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

  const heatmap = `
    <div class="heatmap">
      <div></div>
      ${hours.map(h => `<div class="hm-hour">${h}</div>`).join('')}
      ${days.map((d, row) => `
        <div class="hm-label">${d}</div>
        ${p.heatmap[row].map((v, col) => `<div class="hm-cell ${v ? 'l' + v : ''}" title="${d} ${hours[col]}:00 · 强度 ${v}"></div>`).join('')}
      `).join('')}
    </div>
  `;

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Profile · 工作方式</div>
        <h1>你的工作方式</h1>
        <p class="sub">不是绩效评分。只跟你自己的过去比，每个数字都能下钻到原始事件。</p>
      </div>
      <div class="head-actions">
        <span class="data-head-badge">${icon('lock', 12)} 仅自己可见</span>
        <button class="btn" data-action="toast" data-msg="切换周期（演示）">${icon('calendar', 14)} ${p.period}</button>
      </div>
    </div>

    <div class="profile-top">
      <div class="card radar-card">
        <div class="radar-head">
          <div>
            <h3>六维画像</h3>
            <p class="tiny muted mt-8">基于 ${p.sample} 条事件</p>
          </div>
          <span class="chip accent">较上月 +6</span>
        </div>
        <div class="radar-wrap">${radarChart(p.radar)}</div>
        <div class="radar-legend">
          ${p.radar.map(d => `<span><i></i>${d.label}<b>${d.value}</b></span>`).join('')}
        </div>
      </div>

      <div class="insight-stack">
        ${p.insights.map(i => `
          <div class="insight-card">
            <span class="insight-icon ${i.tone}">${icon(i.icon, 15)}</span>
            <div>
              <h3>${esc(i.title)}</h3>
              <p>${esc(i.text)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="profile-mid">
      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <h3>按时完成率</h3>
            <p class="sub">过去 8 周 · 只统计有截止时间的任务</p>
          </div>
          <div class="chart-value">82% <small>本周</small></div>
        </div>
        ${trendChart(p.trend)}
      </div>

      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <h3>专注时段</h3>
            <p class="sub">颜色越深，深度工作越集中</p>
          </div>
          <span class="chip green">周三上午最佳</span>
        </div>
        ${heatmap}
        <div class="heat-legend">
          少 <i style="background:var(--surface-3)"></i>
          <i style="background:color-mix(in srgb, var(--accent) 18%, var(--surface-3))"></i>
          <i style="background:color-mix(in srgb, var(--accent) 38%, var(--surface-3))"></i>
          <i style="background:color-mix(in srgb, var(--accent) 65%, var(--surface-3))"></i>
          <i style="background:var(--accent)"></i> 多
        </div>
      </div>
    </div>

    <div class="section-title-row">
      <div>
        <h2>可以尝试的实验</h2>
        <p class="sub">每个实验只改变一个变量，两周后回看效果。</p>
      </div>
      <button class="btn btn-sm" data-action="toast" data-msg="已加入下两周实验">${icon('plus', 12)} 加入实验</button>
    </div>

    <div class="experiments">
      ${p.experiments.map((e, i) => `
        <div class="experiment-card">
          <div class="exp-num">实验 ${String(i + 1).padStart(2, '0')}</div>
          <h3>${esc(e.title)}</h3>
          <p>${esc(e.text)}</p>
        </div>
      `).join('')}
    </div>

    <div class="profile-note">
      ${icon('shield', 12)}
      <span>画像数据仅存储在本地；导出时可选择隐藏协作、收入等敏感维度。</span>
      <span style="margin-left:auto">数据充分度：高（312 条事件 / 8 周）</span>
    </div>
  `;
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
    <button class="connector-card" data-action="connector-config" data-id="${c.id}" aria-label="${esc(c.name)}连接配置">
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
        <p class="sub">不只用预设模板。用你自己的话描述怎么工作，AI 把它变成可执行规则。</p>
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
            <button class="btn btn-primary btn-sm" data-action="parse-workflow">${icon('sparkles', 12)} AI 解析为规则</button>
            <button class="btn btn-sm" data-action="workflow-template" data-template="boss">老板派活</button>
            <button class="btn btn-sm" data-action="workflow-template" data-template="meeting">会议行动项</button>
            <button class="btn btn-sm" data-action="workflow-template" data-template="client">客户邮件</button>
            <button class="btn btn-sm btn-ghost" data-action="save-workflow">${icon('check', 12)} 保存</button>
          </div>
        </div>
        <div class="workflow-rules-box">
          <div class="workflow-rules-head">
            <span>已生效的规则</span>
            <span class="chip green">${workflow.rules.length} 条</span>
          </div>
          <div class="workflow-rules" id="workflow-rules">${workflowRules}</div>
          <div class="workflow-rules-foot">${icon('shield', 11)} 规则只在本机执行 · 用于捕获解析 / 今日排期 / 日报</div>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="panel-head">
        <h3>${icon('route', 15)} 数据如何流动</h3>
        <span class="chip green">原始数据永久保留</span>
      </div>
      <div class="panel-body">
        <div class="pipeline">
          <span class="pipe-node"><b>连接器</b><small>CSV / ICS / Webhook</small></span>
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
        <p class="sub">字段、视图、报表模板都可以按你的工作方式扩展，不需要改代码。</p>
      </div>
      <button class="btn btn-sm" data-action="toast" data-msg="新增字段（演示）">${icon('plus', 12)} 新增字段</button>
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
              <td style="text-align:right"><button class="icon-btn sm" data-action="toast" data-msg="编辑字段（演示）">${icon('settings', 12)}</button></td>
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
        <button class="btn btn-sm" data-action="toast" data-msg="立即备份（演示）">${icon('shield', 12)} 立即备份</button>
        <button class="btn btn-sm" data-action="toast" data-msg="导出全部数据（演示）">${icon('download', 12)} 导出全部</button>
      </div>
    </div>

    <div class="card data-health">
      <div class="dh-cell">
        <div class="dh-label">记录</div>
        <div class="dh-value">1,284 <small>条</small></div>
        <div class="dh-foot">任务 / 项目 / 事件</div>
      </div>
      <div class="dh-cell">
        <div class="dh-label">事件</div>
        <div class="dh-value">312 <small>条</small></div>
        <div class="dh-foot">画像与审计的燃料</div>
      </div>
      <div class="dh-cell">
        <div class="dh-label">存储</div>
        <div class="dh-value">86 <small>MB</small></div>
        <div class="dh-foot">SQLite + 附件</div>
      </div>
      <div class="dh-cell">
        <div class="dh-label">上次备份</div>
        <div class="dh-value" style="font-size:14px">今天 08:00</div>
        <div class="dh-foot">保留 7 日 / 4 周 / 12 月</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="panel-head"><h3>${icon('lock', 15)} 隐私与模型策略</h3><span class="chip outline">可逐项目配置</span></div>
      <div class="panel-body">
        <div class="setting-row"><span>默认模型</span><span class="val">DeepSeek（云端）</span></div>
        <div class="setting-row"><span>敏感项目</span><span class="val">强制 Ollama 本地模型</span></div>
        <div class="setting-row"><span>发送前脱敏</span><span class="val">客户名 / 人名 / 合同号</span></div>
        <div class="setting-row"><span>AI 操作日志</span><span class="val" style="color:var(--green)">已开启 · 可撤销</span></div>
      </div>
    </div>
  `;
}
