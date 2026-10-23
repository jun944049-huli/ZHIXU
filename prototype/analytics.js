/* Reports and profile statistics are derived from local records. */
function reportSnapshotKey() {
  return `${state.report}:${reportDateISO()}:${state.reportProject || 'all'}`;
}

function currentReport() {
  return DB.reportSnapshots?.[reportSnapshotKey()]?.report || getReport(state.report, reportDateISO());
}

function factualProjectReport(key, date) {
  const projects = state.reportProject ? DB.projects.filter(p => p.id === state.reportProject) : DB.projects;
  const ids = new Set(projects.map(p => p.id));
  const tasks = allWorkbenchTasks().filter(t => ids.has(t.project));
  const risks = projects.flatMap(p => detailForProject(p).risks.filter(r => r.status !== 'closed').map(r => ({ ...r, projectName: p.name })));
  const names = { project: '项目状态', risk: '风险分析', requirements: '需求清单' };
  const rows = key === 'risk'
    ? [['项目', '风险', '等级', '负责人', '应对'], ...risks.map(r => [r.projectName, r.title, r.level, r.owner || '', r.action || ''])]
    : key === 'requirements'
      ? [['项目', '任务 / 需求', '优先级', '预估', '状态'], ...tasks.map(t => [projectById(t.project)?.name || '', t.title, t.priority, t.estimate || '', t.done ? '已完成' : '未完成'])]
      : [['项目', '进度', '健康度', '未完成任务', '下一节点'], ...projects.map(p => [p.name, `${p.progress}%`, healthLabel(p.health), String(tasks.filter(t => t.project === p.id && !t.done).length), `${p.nextDate} ${p.next}`])];
  return {
    label: names[key], title: `${state.reportProject ? projectById(state.reportProject)?.name || '已删除项目' : '项目组合'} · ${names[key]}`,
    period: date, facts: rows.length - 1,
    blocks: [{ type: 'lead', text: `根据当前本地记录汇总，包含 ${rows.length - 1} 条${names[key]}记录。` },
      { type: 'table', head: rows[0], rows: rows.slice(1) }], rows
  };
}

function reportText(report) {
  return [`# ${report.title}`, '', `${report.period} · ${DB.user.name}`, '',
    ...report.blocks.flatMap(block => block.type === 'h' ? ['## ' + block.text, '']
      : block.type === 'list' ? [...block.items.map(item => '- ' + item), '']
        : block.type === 'table' ? [block.head.join(' | '), ...block.rows.map(row => row.join(' | ')), '']
          : [block.text || '', ''])].join('\n');
}

function openReportEditor() {
  localModal('编辑报表', textField('report-editor-text', '报表正文', reportText(currentReport())), saveButton('report-editor-save'), 'lg');
}

async function saveReportSnapshot(text) {
  const base = currentReport();
  if (typeof text === 'string' && !text.trim()) { showToast('报表正文不能为空'); return; }
  const report = typeof text === 'string' ? {
    ...base, edited: true, blocks: [{ type: 'lead', text }], rows: undefined
  } : base;
  DB.reportSnapshots[reportSnapshotKey()] = { report, savedAt: new Date().toISOString() };
  await finishLocal('报表快照已保存');
}

async function exportCurrentReport(format) {
  const report = currentReport();
  await saveLocalFile({ title: report.title, format, text: reportText(report),
    rows: report.rows || [['报表内容'], ...reportText(report).split('\n').map(line => [line])] });
}

function profileStatistics(days) {
  const from = addDaysISO(DB.meta.today, -days + 1);
  const tasks = tasksInRange(from, DB.meta.today);
  const done = tasks.filter(t => t.done);
  const entries = DB.timeEntries.filter(e => e.date >= from && e.date <= DB.meta.today);
  return { from, tasks, done, hours: entries.reduce((sum, e) => sum + e.seconds / 3600, 0),
    byDay: Array.from({ length: 7 }, (_, index) => {
      const date = addDaysISO(DB.meta.today, index - 6);
      const records = tasksOnDate(date);
      return { date, total: records.length, done: records.filter(t => t.done).length };
    }) };
}

function renderFactualProfile() {
  const days = Number(state.profileDays || 30);
  const stats = profileStatistics(days);
  const maximum = Math.max(1, ...stats.byDay.map(d => d.total));
  return `<div class="page-head"><div><h1>回顾</h1>
    <p class="sub">${stats.from} 至 ${DB.meta.today}</p></div>
    <label class="field">统计周期<select class="select" id="profile-period">
    ${[7, 30, 90].map(n => `<option value="${n}" ${days === n ? 'selected' : ''}>最近 ${n} 天</option>`).join('')}</select></label></div>
    <div class="stat-strip"><div class="stat"><div class="stat-label">安排任务</div><div class="stat-value">${stats.tasks.length}</div></div>
    <div class="stat"><div class="stat-label">已完成</div><div class="stat-value">${stats.done.length}</div></div>
    <div class="stat"><div class="stat-label">完成比例</div><div class="stat-value">${stats.tasks.length ? Math.round(stats.done.length / stats.tasks.length * 100) + '%' : '—'}</div></div>
    <div class="stat"><div class="stat-label">已记录专注时间</div><div class="stat-value">${formatHours(stats.hours)}</div></div></div>
    <section class="feature-section"><h2>最近七天</h2><div class="activity-bars">
    ${stats.byDay.map(d => `<div class="activity-bar-item"><span>${d.done}/${d.total}</span><div class="activity-bar-track">
      <i style="height:${d.total / maximum * 100}%"><b style="height:${d.total ? d.done / d.total * 100 : 0}%"></b></i></div>
      <span>${esc(d.date.slice(5))}</span></div>`).join('')}</div><div class="chart-legend"><span><i class="done"></i>已完成</span><span><i></i>已安排</span></div></section>
    <section class="feature-section"><div class="section-title-row"><h2>两周实验</h2>
      <button class="btn" data-action="record-edit" data-kind="experiment">${icon('plus', 13)} 新增实验</button></div>
      <div class="feature-list">${DB.experiments.map(e => `<div class="feature-list-row"><div><b>${esc(e.title)}</b>
      <p class="small muted">${esc(e.date)} · ${e.status === 'done' ? '已完成' : '进行中'}</p><p>${esc(e.text)}</p></div>
      <button class="icon-btn" data-action="record-edit" data-kind="experiment" data-id="${esc(e.id)}" aria-label="编辑实验">${icon('edit', 14)}</button></div>`).join('') || '<p class="muted">暂无实验记录</p>'}</div></section>`;
}

function previewImpactChange() {
  const title = fieldValue('impact-title'), hours = Number(fieldValue('impact-hours'));
  const mode = fieldValue('impact-mode'), moveId = fieldValue('impact-move');
  if (!title || !Number.isFinite(hours) || hours <= 0 || hours > 1000) { showToast('请填写任务名称和有效小时数'); return; }
  const moved = mode === 'defer' ? taskLocation(moveId) : null;
  if (mode === 'defer' && (!moved || moved.task.done || moved.date !== DB.meta.today)) { showToast('请选择今日未完成的任务'); return; }
  const date = mode === 'nextweek' ? nextMondayISO(DB.meta.today) : DB.meta.today;
  const nextLoad = DB.capacity.committed + (date === DB.meta.today ? hours : 0) -
    (moved ? parseEstimateHours(moved.task.estimate) : 0);
  state.pendingImpact = { title, hours, mode, moveId, date };
  localModal('确认调整', `<p>新增「${esc(title)}」：${esc(date)}，预计 ${hours}h。</p>
    ${moved ? `<p>「${esc(moved.task.title)}」移到 ${addDaysISO(DB.meta.today, 1)}。</p>` : ''}
    <p>调整后今日承诺 ${formatHours(nextLoad)} / ${DB.capacity.available}h。</p>
    <p>沟通草稿：我计划于 ${esc(date)} 完成「${esc(title)}」，预计需要 ${hours} 小时，请确认优先级。</p>`,
    '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="impact-confirm">确认调整</button>');
}

async function confirmImpactChange() {
  const pending = state.pendingImpact;
  if (!pending) return;
  if (pending.mode === 'defer') {
    const found = taskLocation(pending.moveId);
    if (!found || found.task.done || found.date !== DB.meta.today) { showToast('原任务已变化，请重新分析'); return; }
    found.list.splice(found.index, 1);
    addConfirmedTask(found.task, addDaysISO(DB.meta.today, 1), 'should');
  }
  addConfirmedTask({ id: newRecordId('task'), title: pending.title, estimate: `${pending.hours}h`,
    priority: 'P1', project: null, due: pending.date, done: false }, pending.date, 'must');
  DB.communicationDrafts ||= [];
  DB.communicationDrafts.push({ ...pending, createdAt: new Date().toISOString() });
  state.pendingImpact = null;
  await finishLocal('排期已调整，沟通草稿已保存在本机');
}
