/* Local workbench actions share the existing snapshot and persistence queue. */
function initializeFeatures() {
  DB.documents ||= [];
  DB.timeEntries ||= [];
  DB.experiments ||= [];
  DB.reportSnapshots ||= {};
  DB.inboxArchive ||= [];
  DB.taskArchive ||= [];
  Object.values(DB.fields).forEach(fields => fields.forEach(field => { field.id ||= newRecordId('field'); }));
  Object.entries(DB.projectDetails).forEach(([projectId, detail]) => {
    ['milestones', 'risks', 'docs'].forEach(key => (detail[key] || []).forEach(item => { item.id ||= newRecordId(key); }));
    (detail.tasks || []).forEach(legacy => {
      if (allWorkbenchTasks().some(t => t.project === projectId && t.title === legacy.title)) return;
      const shortDate = String(legacy.due || '').match(/^(\d{2})\/(\d{2})$/);
      const date = shortDate ? `${DB.meta.today.slice(0, 4)}-${shortDate[1]}-${shortDate[2]}` : DB.meta.today;
      addConfirmedTask({ ...legacy, id: newRecordId('task'), project: projectId,
        done: legacy.status === '已完成', blocked: legacy.status === '阻塞', overdue: legacy.status === '逾期' },
      date, ['P0', 'P1'].includes(legacy.priority) ? 'must' : 'should');
    });
    detail.tasks = [];
  });
  DB.projects.forEach(p => { p.risks = detailForProject(p).risks.filter(r => r.status !== 'closed').length; });
  migrateOverdueTasks();
}

function migrateOverdueTasks() {
  // Older releases kept reminders separately. Preserve their identities once,
  // then derive every reminder from the actual task instead of a second list.
  for (const item of DB.overdue || []) {
    const match = allWorkbenchTasks().find(task => item.taskId ? task.id === item.taskId
      : task.project === item.project && task.title === item.title);
    if (match) {
      if (!taskDeadlineDate(match)) match.deadlineDate = addDaysISO(DB.meta.today, -Math.max(1, Number(item.days) || 1));
    } else if (!DB.taskArchive.some(task => task.id === (item.taskId || item.id))) {
      addConfirmedTask({ ...item, id: item.taskId || item.id || newRecordId('task'),
        due: addDaysISO(DB.meta.today, -Math.max(1, Number(item.days) || 1)),
        priority: 'P2', estimate: item.estimate || '1h', done: false }, DB.meta.today, 'should');
    }
  }
  DB.overdue = [];
  for (const task of allWorkbenchTasks()) {
    task.scheduledDate ||= taskLocation(task.id)?.date || DB.meta.today;
    const deadline = taskDeadlineDate(task);
    if (deadline) {
      task.deadlineDate = deadline;
      // Freeze relative dates so "yesterday" cannot shift every time the app opens.
      task.due = String(task.due || '').replace(/^(昨天|今天|今日|明天)/, deadline);
    } else if (task.overdue) task.deadlineDate = task.scheduledDate < DB.meta.today
      ? task.scheduledDate : addDaysISO(DB.meta.today, -1);
    task.overdue = isTaskOverdue(task);
  }
}

function localModal(title, body, footer = '', className = '', headerActions = '') {
  document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><div class="modal-head-actions">${headerActions}<button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot feature-actions">${footer}</div>` : ''}
    </div></div>`;
}

function inputField(id, label, value = '', type = 'text', attrs = '') {
  return `<div class="field"><label for="${id}">${esc(label)}</label><input class="input" id="${id}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
}

function selectField(id, label, choices, value) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><select class="select" id="${id}">
    ${choices.map(([key, text]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
}

function textField(id, label, value = '') {
  return `<div class="field full"><label for="${id}">${esc(label)}</label><textarea class="input feature-textarea" id="${id}" maxlength="12000">${esc(value)}</textarea></div>`;
}

const fieldValue = id => document.getElementById(id)?.value.trim() || '';
const saveButton = action => `<button class="btn btn-primary" data-action="${action}">${icon('check', 13)} 保存</button>`;
const projectChoices = () => [['', '未归属'], ...DB.projects.map(p => [p.id, p.name])];

async function finishLocal(message, keepOpen = false) {
  if (!keepOpen) closeModal();
  updateTaskCapacity();
  render();
  try { await persistWorkbench(); showToast(message); }
  catch { /* The storage adapter keeps the failed snapshot available for retry. */ }
}

function taskLocation(id) {
  for (const bucket of ['must', 'should', 'could']) {
    const index = DB.tasks[bucket].findIndex(t => t.id === id);
    if (index >= 0) return { task: DB.tasks[bucket][index], list: DB.tasks[bucket], index, date: DB.meta.today };
  }
  for (const [date, list] of Object.entries(DB.taskCalendar || {})) {
    const index = list.findIndex(t => t.id === id);
    if (index >= 0) return { task: list[index], list, index, date };
  }
  return null;
}

function customFieldInputs(entity, record) {
  return (DB.fields[entity] || []).filter(f => f.status !== '系统' && f.status !== '停用').map(f => {
    const id = 'custom-' + f.id;
    const value = record?.customValues?.[f.id] ?? '';
    if (f.type === '单选' && f.options?.length) {
      const options = [...new Set([...f.options, ...(value ? [String(value)] : [])])];
      return selectField(id, f.name, [['', '未选择'], ...options.map(option => [option, option])], String(value));
    }
    return f.type === '长文本' ? textField(id, f.name, value)
      : inputField(id, f.name, value, f.type === '数字' ? 'number' : 'text', 'maxlength="500"');
  }).join('');
}

function readCustomFields(entity) {
  return Object.fromEntries((DB.fields[entity] || []).filter(f => document.getElementById('custom-' + f.id))
    .map(f => [f.id, fieldValue('custom-' + f.id)]));
}

function openTaskEditor(id) {
  const found = taskLocation(id);
  if (!found) { showToast('任务已不存在'); return; }
  state.editTaskId = id;
  const t = found.task;
  localModal('编辑任务', `<div class="form-grid">
    ${inputField('task-title', '任务标题', t.title, 'text', 'maxlength="150"')}
    ${selectField('task-project', '项目', projectChoices(), t.project || '')}
    ${inputField('task-date', '安排日期', found.date, 'date')}
    ${inputField('task-due', '截止说明', t.due)}
    ${inputField('task-hours', '预计小时', parseEstimateHours(t.estimate), 'number', 'min="0.1" max="1000" step="0.1"')}
    ${selectField('task-priority', '优先级', ['P0', 'P1', 'P2', 'P3', 'P4'].map(p => [p, p]), t.priority)}
    ${selectField('task-status', '状态', [['open', '待开始'], ['doing', '进行中'], ['blocked', '阻塞'], ['done', '已完成']],
      t.done ? 'done' : t.blocked ? 'blocked' : t.status === '进行中' ? 'doing' : 'open')}
    ${inputField('task-assignee', '负责人', t.assignee || DB.user.name)}
    ${textField('task-note', '备注', t.note || '')}
    ${customFieldInputs('task', t)}</div>`,
    `<button class="btn btn-danger" data-action="task-delete">${icon('trash', 13)} 删除任务</button>${saveButton('task-save')}`, 'task-editor');
}

async function saveTaskEditor() {
  const found = taskLocation(state.editTaskId);
  const hours = Number(fieldValue('task-hours'));
  const date = fieldValue('task-date');
  if (!found || !fieldValue('task-title') || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      toISODate(parseISODate(date)) !== date || hours <= 0 || hours > 1000 || !Number.isFinite(hours)) {
    showToast('请填写标题、日期和有效的预计小时'); return;
  }
  const t = found.task;
  const previousDue = String(t.due || '');
  const previousDeadline = taskDeadlineDate(t);
  const status = fieldValue('task-status');
  if (status) {
    t.done = status === 'done';
    t.blocked = status === 'blocked';
    t.status = status === 'doing' ? '进行中' : status === 'done' ? '已完成' : '待开始';
    t.completedAt = t.done ? t.completedAt || new Date().toISOString() : null;
    if (t.done && DB.runningTimer?.taskId === t.id) stopTaskTimer();
  }
  Object.assign(t, {
    title: fieldValue('task-title'), project: fieldValue('task-project') || null,
    due: fieldValue('task-due'), estimate: `${hours}h`, priority: fieldValue('task-priority'),
    assignee: fieldValue('task-assignee'), note: fieldValue('task-note'), customValues: { ...t.customValues, ...readCustomFields('task') }
  });
  if (t.due !== previousDue) {
    delete t.deadlineDate;
    t.deadlineDate = taskDeadlineDate(t, date);
  } else if (date !== found.date && previousDeadline && previousDeadline < DB.meta.today) {
    t.due = date;
    t.deadlineDate = date;
  }
  t.overdue = isTaskOverdue(t);
  found.list.splice(found.index, 1);
  addConfirmedTask(t, date, ['P0', 'P1'].includes(t.priority) ? 'must' : t.priority === 'P4' ? 'could' : 'should');
  await finishLocal('任务已保存');
}

function requestTaskDelete() {
  const found = taskLocation(state.editTaskId);
  if (!found) return;
  localModal('删除任务', `<p>确认移除「${esc(found.task.title)}」？原文和任务记录会保留在本机归档中。</p>`,
    `<button class="btn" data-action="close-modal">取消</button><button class="btn btn-danger" data-action="task-delete-confirm">确认删除</button>`);
}

function stopTaskTimer() {
  const running = DB.runningTimer;
  if (!running) return;
  const duration = Math.max(0, Math.floor((Date.now() - running.startedAt) / 1000));
  DB.timeEntries.push({ ...running, id: newRecordId('time'), seconds: duration, endedAt: new Date().toISOString() });
  DB.runningTimer = null;
}

async function toggleTimer(id) {
  const found = taskLocation(id);
  if (!found || found.task.done) { showToast('已完成的任务不能开始计时'); return; }
  const stopping = DB.runningTimer?.taskId === id;
  stopTaskTimer();
  if (!stopping) DB.runningTimer = {
    taskId: id, title: found.task.title, project: found.task.project, startedAt: Date.now(), date: DB.meta.today
  };
  await finishLocal(stopping ? '计时已保存' : '开始计时，再次点击可停止');
}

function timerLabel(id) {
  if (DB.runningTimer?.taskId !== id) return '开始计时';
  const minutes = Math.floor((Date.now() - DB.runningTimer.startedAt) / 60000);
  return `停止计时 · ${minutes} 分钟`;
}

function filterTasks(tasks) {
  return tasks.filter(t => (!state.taskFilterProject || (state.taskFilterProject === 'none' ? !t.project : t.project === state.taskFilterProject)) &&
    (!state.taskFilterStatus || (state.taskFilterStatus === 'done' ? t.done : !t.done)))
    .slice().sort((a, b) => state.taskSort === 'estimate'
      ? parseEstimateHours(a.estimate) - parseEstimateHours(b.estimate)
      : (a.priority || 'P2').localeCompare(b.priority || 'P2'));
}

function openTaskFilter() {
  localModal('筛选任务', `<div class="form-grid">
    ${selectField('filter-project', '项目', [['', '所有项目'], ['none', '未归属'], ...DB.projects.map(p => [p.id, p.name])], state.taskFilterProject || '')}
    ${selectField('filter-status', '状态', [['', '全部状态'], ['open', '未完成'], ['done', '已完成']], state.taskFilterStatus || '')}
    ${selectField('filter-sort', '排序', [['priority', '优先级'], ['estimate', '预计时长']], state.taskSort || 'priority')}</div>`, saveButton('task-filter-save'));
}

function openWorkHours() {
  const lunch = String(DB.workday.lunch).split('–');
  localModal('工作时间', `<div class="form-grid">
    ${inputField('work-start', '上班', DB.workday.start, 'time')}${inputField('work-end', '下班', DB.workday.end, 'time')}
    ${inputField('lunch-start', '午休开始', lunch[0], 'time')}${inputField('lunch-end', '午休结束', lunch[1], 'time')}
    </div>`, saveButton('work-hours-save'));
}

async function saveWorkHours() {
  const values = ['work-start', 'lunch-start', 'lunch-end', 'work-end'].map(fieldValue);
  if (values.some(v => !/^\d{2}:\d{2}$/.test(v)) || values.some((v, i) => i && v <= values[i - 1])) {
    showToast('请按上班、午休开始、午休结束、下班的先后顺序填写'); return;
  }
  const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  DB.workday.start = values[0]; DB.workday.end = values[3]; DB.workday.lunch = `${values[1]}–${values[2]}`;
  DB.capacity.available = Math.round((minutes(values[3]) - minutes(values[0]) - minutes(values[2]) + minutes(values[1])) / 6) / 10;
  DB.workday.blocks = [];
  await finishLocal('工作时间与可用产能已更新');
}

function archiveInbox(ids, disposition = 'ignored') {
  const selected = new Set(ids);
  DB.inbox.filter(i => selected.has(i.id)).forEach(item => DB.inboxArchive.push({
    ...item, [disposition === 'deleted' ? 'deletedAt' : 'ignoredAt']: new Date().toISOString()
  }));
  DB.inbox = DB.inbox.filter(i => !selected.has(i.id));
  state.inboxId = DB.inbox[0]?.id || null;
}

function requestInboxDelete(id) {
  const item = DB.inbox.find(i => i.id === id);
  if (!item) { showToast('这条事项已不在收件箱中'); return; }
  localModal('删除收件箱事项', `<p>确认删除「${esc(item.title)}」？</p>
    <p class="small muted mt-12">删除后移入回收站，可在“归档与回收站”中恢复。已创建的任务不会受到影响。</p>`,
    `<button class="btn" data-action="close-modal">取消</button>
    <button class="btn btn-danger" data-action="inbox-delete-confirm" data-id="${esc(item.id)}">${icon('trash', 13)} 确认删除</button>`);
}

async function deleteInboxItem(id) {
  if (!DB.inbox.some(i => i.id === id)) { closeModal(); showToast('这条事项已不在收件箱中'); return; }
  archiveInbox([id], 'deleted');
  await finishLocal('事项已删除，可在归档与回收站中恢复');
}

function openInboxBatch() {
  localModal('批量归档', `<div class="feature-list">${DB.inbox.map(i => `<label class="feature-choice">
    <input type="checkbox" name="archive-inbox" value="${esc(i.id)}"><span>${esc(i.title)}</span></label>`).join('') || '暂无待处理事项'}</div>`,
    `<button class="btn btn-primary" data-action="inbox-batch-confirm">${icon('inbox', 13)} 归档所选</button>`);
}

function openInboxArchive() {
  state.clearInboxArchiveIds = null;
  localModal('归档与回收站', `<div class="feature-list">${DB.inboxArchive.slice().reverse().map(i => `<div class="feature-list-row">
    <div><b>${esc(i.title)}</b><p class="small muted">${i.confirmedTask ? '已转为任务' : i.deletedAt ? '已删除 · 回收站' : '已忽略'}</p></div>
    ${i.confirmedTask ? '' : `<button class="btn btn-sm" data-action="inbox-restore" data-id="${esc(i.id)}">恢复</button>`}</div>`).join('') || '暂无归档'}</div>`,
    '', '', `<button class="btn btn-sm btn-danger" data-action="inbox-archive-clear" ${DB.inboxArchive.length ? '' : 'disabled'}>${icon('trash', 13)} 清空</button>`);
}

function requestInboxArchiveClear() {
  if (!DB.inboxArchive.length) { openInboxArchive(); return; }
  state.clearInboxArchiveIds = DB.inboxArchive.map(item => item.id);
  localModal('清空归档与回收站', `<p>确认清空当前全部 ${state.clearInboxArchiveIds.length} 条记录？</p>
    <p class="small muted mt-12">包含已删除、已忽略和已转为任务的归档原文，清空后无法从这里恢复。待处理收件箱和已创建的任务不受影响。</p>`,
    `<button class="btn" data-action="inbox-archive">取消</button>
    <button class="btn btn-danger" data-action="inbox-archive-clear-confirm">${icon('trash', 13)} 确认清空</button>`);
}

async function clearInboxArchive() {
  const selected = new Set(state.clearInboxArchiveIds || []);
  state.clearInboxArchiveIds = null;
  const removed = DB.inboxArchive.filter(item => selected.has(item.id));
  if (!removed.length) { openInboxArchive(); return; }
  // Keep source identifiers only, so later syncs cannot resurrect cleared messages.
  const receipts = new Set(DB.integrationReceipts.map(item => JSON.stringify([item.connectorId, item.externalId])));
  removed.forEach(({ connectorId, externalId }) => {
    if (!connectorId || !externalId) return;
    const key = JSON.stringify([connectorId, externalId]);
    if (receipts.has(key)) return;
    DB.integrationReceipts.push({ connectorId, externalId });
    receipts.add(key);
  });
  DB.inboxArchive = DB.inboxArchive.filter(item => !selected.has(item.id));
  await finishLocal(`已清空 ${removed.length} 条归档与回收站记录`);
  openInboxArchive();
}

function openInboxSplit() {
  const item = DB.inbox.find(i => i.id === state.inboxId) || DB.inbox[0];
  if (!item) return;
  state.splitInboxId = item.id;
  localModal('拆分收件箱事项', textField('split-titles', '每行一个事项标题', (item.subtasks || []).join('\n')),
    `<button class="btn btn-primary" data-action="inbox-split-confirm">${icon('layers', 13)} 确认拆分</button>`);
}

async function splitInbox() {
  const item = DB.inbox.find(i => i.id === state.splitInboxId);
  const titles = fieldValue('split-titles').split('\n').map(s => s.trim()).filter(Boolean);
  if (!item || titles.length < 2 || titles.length > 20) { showToast('请填写 2 到 20 个标题，每行一个'); return; }
  archiveInbox([item.id]);
  titles.forEach((title, index) => DB.inbox.unshift({
    ...item, id: newRecordId('inbox'), connectorId: undefined, externalId: undefined,
    title: title.slice(0, 150), parentInboxId: item.id, subtasks: [],
    p50: formatHours(Math.max(0.1, parseEstimateHours(item.p50) / titles.length)),
    note: `拆分 ${index + 1}/${titles.length} · 来源原文保留`
  }));
  state.inboxId = DB.inbox[0].id;
  await finishLocal(`已拆分为 ${titles.length} 条待确认事项`);
}

function editableProjectDetail() {
  const p = projectById(state.projectId);
  if (!p) return null;
  if (!DB.projectDetails[p.id]) DB.projectDetails[p.id] = detailForProject(p);
  const detail = DB.projectDetails[p.id];
  ['milestones', 'risks', 'docs'].forEach(key => detail[key].forEach(item => { item.id ||= newRecordId(key); }));
  return detail;
}

function raiseProjectRisk(project, raw) {
  DB.projectDetails[project.id] ||= detailForProject(project);
  const risks = DB.projectDetails[project.id].risks;
  const risk = risks.find(r => r.status !== 'closed');
  if (risk) Object.assign(risk, { level: '高', score: 16, p: 4, i: 4 });
  else risks.push({ id: newRecordId('risk'), title: String(raw || '待跟进风险').slice(0, 150),
    level: '高', score: 16, p: 4, i: 4, owner: DB.user.name, action: '待补充应对措施', status: 'open' });
  project.risks = risks.filter(r => r.status !== 'closed').length;
}

function openRecordEditor(kind, id) {
  const detail = ['risk', 'milestone'].includes(kind) ? editableProjectDetail() : null;
  const list = kind === 'risk' ? detail?.risks : kind === 'milestone' ? detail?.milestones
    : kind === 'waiting' ? DB.waiting : kind === 'experiment' ? DB.experiments : DB.fields[state.fieldsTab];
  if (!list) return;
  const record = list.find(item => item.id === id) || {};
  state.recordEditor = { kind, id, projectId: state.projectId, fieldTab: state.fieldsTab };
  const names = { risk: '风险', milestone: '里程碑', waiting: '等待事项', experiment: '实验', field: '字段' };
  let body = '';
  if (kind === 'risk') body = inputField('record-title', '风险名称', record.title) +
    inputField('risk-probability', '概率（1–5）', record.p || 3, 'number', 'min="1" max="5" step="1"') +
    inputField('risk-impact', '影响（1–5）', record.i || 3, 'number', 'min="1" max="5" step="1"') +
    inputField('record-owner', '负责人', record.owner || DB.user.name) + textField('record-note', '应对动作', record.action) +
    selectField('record-status', '状态', [['open', '处理中'], ['closed', '已关闭']], record.status || 'open') + customFieldInputs('risk', record);
  if (kind === 'milestone') body = inputField('record-title', '节点名称', record.name) +
    inputField('record-date', '日期', record.date || DB.meta.today) + textField('record-note', '备注', record.note) +
    selectField('record-status', '状态', [['open', '未完成'], ['risk', '有风险'], ['done', '已完成']], record.status || 'open');
  if (kind === 'waiting') body = inputField('record-title', '等待事项', record.title) +
    inputField('record-owner', '等待谁', record.person) + inputField('record-days', '已等待天数', record.days || 0, 'number', 'min="0" max="3650"') +
    selectField('record-project', '项目', projectChoices(), record.project || '') + textField('record-note', '影响', record.impact);
  if (kind === 'experiment') body = inputField('record-title', '实验名称', record.title) +
    textField('record-note', '做法与观察结果', record.text) + inputField('record-date', '复盘日期', record.date || addDaysISO(DB.meta.today, 14), 'date') +
    selectField('record-status', '状态', [['open', '进行中'], ['done', '已完成']], record.status || 'open');
  if (kind === 'field') body = inputField('record-title', '字段名称', record.name) +
    selectField('record-type', '类型', ['文本', '长文本', '数字', '人员', '关联', '单选'].map(t => [t, t]), record.type || '文本') +
    textField('record-options', '单选候选项（每行一个，仅单选类型使用）', (record.options || []).join('\n')) +
    inputField('record-note', '用途', record.use) +
    selectField('record-status', '状态', [['启用', '启用'], ['停用', '停用']], record.status || '启用');
  if (record.status === '系统') {
    localModal('系统字段', `<p>${esc(record.name)}由任务模型管理，可在任务编辑中修改具体值。</p>`); return;
  }
  localModal((id ? '编辑' : '新增') + names[kind], `<div class="form-grid">${body}</div>`,
    (id ? '<button class="btn btn-danger" data-action="record-remove">移除</button>' : '') + saveButton('record-save'), 'record-editor');
}

function editorRecordList(editor) {
  const detail = DB.projectDetails[editor.projectId];
  return editor.kind === 'risk' ? detail?.risks : editor.kind === 'milestone' ? detail?.milestones
    : editor.kind === 'waiting' ? DB.waiting : editor.kind === 'experiment' ? DB.experiments : DB.fields[editor.fieldTab];
}

async function saveRecordEditor() {
  const editor = state.recordEditor;
  if (!editor || !fieldValue('record-title')) { showToast('请填写名称'); return; }
  const list = editorRecordList(editor);
  if (!list) return;
  const item = list.find(r => r.id === editor.id) || { id: newRecordId(editor.kind) };
  const title = fieldValue('record-title').slice(0, 150);
  const note = fieldValue('record-note');
  if (editor.kind === 'risk') {
    const p = Number(fieldValue('risk-probability')), i = Number(fieldValue('risk-impact'));
    if (![p, i].every(v => Number.isInteger(v) && v >= 1 && v <= 5)) { showToast('概率与影响须为 1 到 5 的整数'); return; }
    Object.assign(item, { title, action: note, p, i, score: p * i, level: p * i >= 15 ? '高' : p * i >= 8 ? '中' : '低',
      owner: fieldValue('record-owner'), status: fieldValue('record-status'), customValues: { ...item.customValues, ...readCustomFields('risk') } });
  } else if (editor.kind === 'milestone') {
    if (!fieldValue('record-date')) { showToast('请填写日期'); return; }
    Object.assign(item, { name: title, note, date: fieldValue('record-date'), status: fieldValue('record-status') });
  } else if (editor.kind === 'waiting') {
    const days = Number(fieldValue('record-days'));
    if (!Number.isInteger(days) || days < 0 || days > 3650) { showToast('等待天数须为 0 到 3650'); return; }
    Object.assign(item, { title, person: fieldValue('record-owner'), days, impact: note, project: fieldValue('record-project') || null });
  } else if (editor.kind === 'experiment') Object.assign(item, { title, text: note, date: fieldValue('record-date'), status: fieldValue('record-status') });
  else {
    if (list.some(f => f.id !== item.id && f.name === title)) { showToast('同一类型中已存在这个字段'); return; }
    const options = [...new Set(fieldValue('record-options').split('\n').map(value => value.trim()).filter(Boolean))];
    if (fieldValue('record-type') === '单选' && !options.length) { showToast('请为单选字段填写候选项'); return; }
    Object.assign(item, { name: title, type: fieldValue('record-type'), use: note, status: fieldValue('record-status'), options });
  }
  if (!editor.id) list.push(item);
  if (editor.kind === 'risk') projectById(editor.projectId).risks = list.filter(r => r.status !== 'closed').length;
  await finishLocal('记录已保存');
}

function requestRecordRemove() {
  localModal('移除记录', '<p>确认移除这条记录？记录会保留在本机归档中。</p>',
    '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-danger" data-action="record-remove-confirm">确认移除</button>');
}

async function removeEditorRecord() {
  const editor = state.recordEditor;
  const list = editorRecordList(editor);
  const index = list?.findIndex(r => r.id === editor.id);
  if (index == null || index < 0) return;
  if (list[index].status === '系统') return;
  DB.recordArchive ||= [];
  DB.recordArchive.push({ ...editor, record: list[index], removedAt: new Date().toISOString() });
  list.splice(index, 1);
  if (editor.kind === 'risk') projectById(editor.projectId).risks = list.filter(r => r.status !== 'closed').length;
  await finishLocal('记录已移除并归档');
}

function openWaiting() {
  localModal('等待事项', `<div class="feature-list">${DB.waiting.map(w => `<div class="feature-list-row"><div><b>${esc(w.title)}</b><p class="small muted">${esc(w.person)} · ${w.days} 天 · ${esc(w.impact)}</p></div>
    <button class="icon-btn" aria-label="编辑等待事项" data-action="record-edit" data-kind="waiting" data-id="${esc(w.id)}">${icon('edit', 14)}</button></div>`).join('') || '暂无等待事项'}</div>`,
    '<button class="btn btn-primary" data-action="record-edit" data-kind="waiting">新增等待事项</button>');
}

function openOverdue() {
  localModal('逾期事项', `<div class="feature-list overdue-list">${overdueTasks().map(t => `<div class="feature-list-row">
    <div class="overdue-item-main"><b>${esc(t.title)}</b><p class="small muted">${esc(projectById(t.project)?.name || '未归属')} · 逾期 ${t.days} 天</p></div>
    <button class="btn btn-sm" data-action="task-edit" data-id="${esc(t.id)}">改期 / 编辑</button>
    <button class="btn btn-sm" data-action="overdue-plan" data-id="${esc(t.id)}">安排到今日</button></div>`).join('') || '暂无逾期事项'}</div>`);
}

function openNotifications() {
  const followed = DB.projects.filter(p => p.followMilestones);
  localModal('本地简报', `<div class="feature-list">
    <p>待确认 ${DB.inbox.length} 条 · 等待事项 ${DB.waiting.length} 条</p>
    ${DB.runningTimer ? `<p>正在计时：${esc(DB.runningTimer.title)}</p>` : ''}
    ${followed.flatMap(p => detailForProject(p).milestones.filter(m => m.status !== 'done').map(m =>
      `<p>${esc(p.name)} · ${esc(m.name)} · ${esc(m.date)}</p>`)).join('') || '<p class="muted">暂无关注的里程碑</p>'}</div>`);
}

function openTextImport(target) {
  openDocumentImport(target);
}

async function importTextDocument() {
  await importDocuments();
}

function openDocument(id) {
  const doc = DB.documents.find(d => d.id === id);
  if (!doc) { localModal('示例文档', '<p>这是示例条目，没有附带文件。请上传自己的项目文档。</p>'); return; }
  openDocumentEditor(id);
}

async function saveLocalFile(payload) {
  try {
    if (window.xiaoyuDesktop?.exportFile) {
      const result = await window.xiaoyuDesktop.exportFile(payload);
      if (result.saved) showToast('文件已导出');
      return result.saved;
    }
    if (!['md', 'csv', 'json'].includes(payload.format)) { showToast('请使用桌面版导出 DOCX、XLSX 或 PDF'); return false; }
    const csv = rows => '\ufeff' + rows.map(row => row.map(value =>
      '"' + (/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const text = payload.format === 'csv' ? csv(payload.rows || []) : payload.text;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: payload.format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
    link.download = `${payload.title.replace(/[<>:"/\\|?*]/g, '_')}.${payload.format}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast('导出文件已生成'); return true;
  } catch { showToast('文件未能导出，请检查目标位置并重试'); return false; }
}

async function exportProjects() {
  const rows = [['项目', '负责人', '进度', '健康度', '下一节点', '日期', '未完成任务'],
    ...DB.projects.map(p => [p.name, p.owner, `${p.progress}%`, healthLabel(p.health), p.next, p.nextDate,
      String(allWorkbenchTasks().filter(t => t.project === p.id && !t.done).length)])];
  await saveLocalFile({ title: '项目台账-' + DB.meta.today, format: 'csv', rows, text: '' });
}

function exportableSnapshot() {
  const snapshot = workbenchSnapshot();
  delete snapshot.db.settings;
  delete snapshot.preferences['jw-settings'];
  return snapshot;
}

async function exportAllData() {
  await saveLocalFile({ title: '知序数据-' + DB.meta.today, format: 'json',
    text: JSON.stringify({ ...exportableSnapshot(), exportedAt: new Date().toISOString(), excludes: '连接凭据与供应商设置' }, null, 2) });
}

async function backupWorkbench() {
  try {
    await persistWorkbench();
    if (!window.xiaoyuDesktop?.backup) { await exportAllData(); return; }
    const result = await window.xiaoyuDesktop.backup();
    if (!result.saved) return;
    DB.meta.lastBackup = new Date().toISOString();
    await finishLocal(DB.documents.some(doc => doc.assetId)
      ? '数据库备份已保存；原附件文件夹需另行备份' : '数据库备份已保存');
  } catch { showToast('备份失败，请选择其他位置后重试'); }
}

async function copyLocalText(text, title = '复制文本') {
  try { await navigator.clipboard.writeText(text); showToast('已复制'); }
  catch {
    localModal(title, textField('copy-text', '待复制文本', text));
    const input = document.getElementById('copy-text'); input.focus(); input.select();
  }
}

function handleFeatureAction(action, el) {
  const id = el.dataset.id || el.closest('[data-task]')?.dataset.task;
  switch (action) {
    case 'task-edit': openTaskEditor(id); break;
    case 'task-save': void saveTaskEditor(); break;
    case 'task-delete': requestTaskDelete(); break;
    case 'task-delete-confirm': {
      const found = taskLocation(state.editTaskId);
      if (!found) break;
      if (DB.runningTimer?.taskId === found.task.id) stopTaskTimer();
      DB.taskArchive.push({ ...found.task, removedAt: new Date().toISOString() });
      found.list.splice(found.index, 1);
      void finishLocal('任务已移除并归档'); break;
    }
    case 'task-timer': void toggleTimer(id); break;
    case 'task-filter': openTaskFilter(); break;
    case 'task-filter-save':
      state.taskFilterProject = fieldValue('filter-project'); state.taskFilterStatus = fieldValue('filter-status'); state.taskSort = fieldValue('filter-sort');
      closeModal(); render(); break;
    case 'work-hours': openWorkHours(); break;
    case 'work-hours-save': void saveWorkHours(); break;
    case 'inbox-delete': requestInboxDelete(id); break;
    case 'inbox-delete-confirm': void deleteInboxItem(id); break;
    case 'inbox-ignore': {
      const item = DB.inbox.find(i => i.id === state.inboxId) || DB.inbox[0];
      if (item) { archiveInbox([item.id]); void finishLocal('已忽略，可在归档中恢复'); } break;
    }
    case 'inbox-batch': openInboxBatch(); break;
    case 'inbox-batch-confirm': {
      const ids = [...document.querySelectorAll('[name="archive-inbox"]:checked')].map(c => c.value);
      if (!ids.length) { showToast('请勾选要归档的事项'); break; }
      archiveInbox(ids); void finishLocal(`已归档 ${ids.length} 条`); break;
    }
    case 'inbox-archive': openInboxArchive(); break;
    case 'inbox-archive-clear': requestInboxArchiveClear(); break;
    case 'inbox-archive-clear-confirm': void clearInboxArchive(); break;
    case 'inbox-restore': {
      const index = DB.inboxArchive.findIndex(i => i.id === id && !i.confirmedTask);
      if (index < 0) break;
      const [item] = DB.inboxArchive.splice(index, 1); delete item.ignoredAt; delete item.deletedAt;
      DB.inbox.unshift(item); state.inboxId = item.id; void finishLocal('已恢复到收件箱'); break;
    }
    case 'inbox-split': openInboxSplit(); break;
    case 'inbox-split-confirm': void splitInbox(); break;
    case 'record-edit': openRecordEditor(el.dataset.kind, id); break;
    case 'record-save': void saveRecordEditor(); break;
    case 'record-remove': requestRecordRemove(); break;
    case 'record-remove-confirm': void removeEditorRecord(); break;
    case 'waiting': openWaiting(); break;
    case 'overdue': openOverdue(); break;
    case 'overdue-plan': {
      const located = taskLocation(id);
      if (!located || !isTaskOverdue(located.task)) break;
      located.list.splice(located.index, 1);
      located.task.overdue = false;
      located.task.due = DB.meta.today;
      located.task.deadlineDate = DB.meta.today;
      addConfirmedTask(located.task, DB.meta.today,
        ['P0', 'P1'].includes(located.task.priority) ? 'must' : located.task.priority === 'P4' ? 'could' : 'should');
      void finishLocal('已安排到今日'); break;
    }
    case 'notifications': openNotifications(); break;
    case 'project-board': state.projectBoard = !state.projectBoard; render(); break;
    case 'milestone-follow': {
      const project = projectById(state.projectId);
      if (project) { project.followMilestones = !project.followMilestones; void finishLocal(project.followMilestones ? '里程碑已加入本地简报' : '已取消关注'); }
      break;
    }
    case 'project-export': void exportProjects(); break;
    case 'document-upload': openTextImport('project'); break;
    case 'chat-attachment': openTextImport('chat'); break;
    case 'document-import': void importTextDocument().catch(error => showToast(error.message || '文件读取失败')); break;
    case 'document-open': openDocument(id); break;
    case 'document-library': openDocumentLibrary(); break;
    case 'document-save': void saveDocumentEditor().catch(error => showToast(error.message || '文档保存失败')); break;
    case 'document-apply': void saveDocumentEditor(true).catch(error => showToast(error.message || '归档失败')); break;
    case 'document-reanalyze': void reanalyzeDocument().catch(error => showToast(error.message || '分析失败')); break;
    case 'document-reanalyze-confirm': void reanalyzeDocument(true).catch(error => showToast(error.message || '分析失败')); break;
    case 'document-task-add': updateDocumentDraft('add'); break;
    case 'document-task-remove': updateDocumentDraft('remove', el.dataset.index); break;
    case 'document-original': void exportDocumentOriginal().catch(error => showToast(error.message || '原文件导出失败')); break;
    case 'document-reparse': void reparseSavedDocument().catch(error => showToast(error.message || '重新解析失败')); break;
    case 'document-export': {
      const doc = DB.documents.find(d => d.id === state.documentId);
      if (doc) void saveLocalFile({ title: doc.title, format: 'md', text: doc.content }); break;
    }
    case 'data-export': void exportAllData(); break;
    case 'data-backup': void backupWorkbench(); break;
    case 'report-copy': void copyLocalText(reportText(currentReport())); break;
    case 'report-export': void exportCurrentReport(el.dataset.format || fieldValue('report-export-format') || 'md'); break;
    case 'report-edit': openReportEditor(); break;
    case 'report-save': void saveReportSnapshot(); break;
    case 'report-editor-save': void saveReportSnapshot(fieldValue('report-editor-text')); break;
    case 'report-regenerate': {
      const key = reportSnapshotKey(); delete DB.reportSnapshots[key];
      void finishLocal('已根据当前记录重新汇总'); break;
    }
    case 'command-weekly': state.report = 'weekly'; state.view = 'reports'; closeModal(); render(); break;
    case 'impact-preview': previewImpactChange(); break;
    case 'impact-confirm': void confirmImpactChange(); break;
    default: return false;
  }
  return true;
}
