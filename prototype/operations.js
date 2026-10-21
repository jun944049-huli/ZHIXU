/* Confirmed user operations update data before rendering and saving. */
function newRecordId(prefix) {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  return prefix + '-' + id;
}

function updateTaskCapacity() {
  const planned = [...DB.tasks.must, ...DB.tasks.should].filter(t => !t.done);
  DB.capacity.committed = Math.round(planned.reduce((sum, task) => sum + parseEstimateHours(task.estimate), 0) * 10) / 10;
  DB.capacity.focus = Math.max(0, Math.round((DB.capacity.committed - DB.capacity.meeting) * 10) / 10);
  DB.capacity.buffer = Math.max(0, Math.round((DB.capacity.available - DB.capacity.committed) * 10) / 10);
}

function toggleTask(id) {
  if (!id) return;
  const task = [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could,
    ...Object.values(DB.taskCalendar || {}).flat()].find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.completedAt = task.done ? new Date().toISOString() : null;
  updateTaskCapacity();
  render();
  void persistWorkbench().catch(() => {});
}

function addConfirmedTask(task, date, bucket) {
  task.scheduledDate = date;
  if (date === DB.meta.today) DB.tasks[bucket].push(task);
  else {
    DB.taskCalendar = DB.taskCalendar || {};
    if (!DB.taskCalendar[date]) DB.taskCalendar[date] = [];
    DB.taskCalendar[date].push(task);
  }
  updateTaskCapacity();
}

async function saveProject() {
  const name = document.getElementById('project-name').value.trim();
  const progressInput = document.getElementById('project-progress');
  const progress = Number(progressInput.value);
  if (!name || !progressInput.value || !progressInput.checkValidity() || !Number.isFinite(progress)) {
    showToast('请填写项目名称，进度须为 0 到 100 的整数');
    return;
  }
  const existing = state.editProjectId ? projectById(state.editProjectId) : null;
  if (state.editProjectId && !existing) { showToast('项目已不存在'); return; }
  const project = {
    ...(existing || {
      id: newRecordId('project'), color: DB.user.color, planned: 0, open: 0, risks: 0,
      members: [{ i: DB.user.initials, c: DB.user.color }],
      createdAt: new Date().toISOString()
    }),
    name,
    code: document.getElementById('project-code').value.trim() || 'PRJ',
    goal: document.getElementById('project-goal').value.trim(),
    owner: document.getElementById('project-owner').value.trim() || DB.user.name,
    progress, health: document.getElementById('project-health').value,
    next: document.getElementById('project-next').value.trim() || '未安排',
    nextDate: document.getElementById('project-next-date').value.trim() || '—',
    updated: '刚刚'
  };
  if (existing) Object.assign(existing, project);
  else DB.projects.push(project);
  closeModal();
  state.view = 'project';
  state.projectId = project.id;
  state.projectTab = 'overview';
  render();
  try {
    await persistWorkbench();
    showToast(existing ? '项目已更新' : '项目已创建');
  } catch (error) { /* The storage adapter displays the error and keeps changes for retry. */ }
}

async function deleteProject() {
  const id = state.deleteProjectId;
  const project = projectById(id);
  if (!project) return;
  DB.projectArchive = DB.projectArchive || [];
  DB.projectArchive.push({
    project, detail: DB.projectDetails?.[id], notes: DB.projectNotes?.[id] || [],
    deletedAt: new Date().toISOString()
  });
  DB.projects = DB.projects.filter(p => p.id !== id);
  const linked = [...allWorkbenchTasks(), ...DB.inbox, ...(DB.inboxArchive || []),
    ...(DB.waiting || []), ...(DB.overdue || [])];
  linked.forEach(item => {
    if (item.project === id) { item.previousProject = id; item.project = null; }
  });
  if (DB.projectDetails) delete DB.projectDetails[id];
  if (DB.projectNotes) delete DB.projectNotes[id];
  saveProjectNotes();
  if (state.chatContext === id) state.chatContext = 'auto';
  state.deleteProjectId = null;
  state.projectId = DB.projects[0]?.id || null;
  state.view = 'projects';
  closeModal();
  render();
  try {
    await persistWorkbench();
    showToast('项目已删除，关联任务已保留');
  } catch (error) { /* The storage adapter displays the error and keeps changes for retry. */ }
}

async function confirmCapture() {
  const draft = state.captureDraft;
  if (!draft) return;
  if (document.getElementById('capture-text')?.value.trim() !== draft.raw) {
    showToast('原文已经修改，请重新解析后确认');
    return;
  }
  const title = document.getElementById('capture-title').value.trim();
  const project = document.getElementById('capture-project').value;
  const date = document.getElementById('capture-date').value;
  const estimate = Number(document.getElementById('capture-estimate').value);
  const priority = document.getElementById('capture-priority').value;
  if (!title || !date || !Number.isFinite(estimate) || estimate <= 0 || estimate > 1000) {
    showToast('请填写任务标题、日期和有效的预计时长');
    return;
  }
  const sourceId = newRecordId('source');
  DB.sourceItems = DB.sourceItems || [];
  DB.sourceItems.push({
    id: sourceId, raw: draft.raw, source: draft.source, createdAt: new Date().toISOString()
  });
  addConfirmedTask({
    id: newRecordId('task'), title, project: project || null,
    estimate: `${estimate}h`, due: date, priority, sourceId, done: false,
    createdAt: new Date().toISOString()
  }, date, ['P0', 'P1'].includes(priority) ? 'must' : 'should');
  state.captureDraft = null;
  closeModal();
  state.view = 'today';
  state.todayDate = date;
  state.todayRange = 'day';
  render();
  try {
    await persistWorkbench();
    showToast('任务已保存，原始消息已保留');
  } catch (error) { /* Persistence error is displayed by the storage adapter. */ }
}

async function confirmInbox() {
  const item = DB.inbox.find(i => i.id === state.inboxId) || DB.inbox[0];
  if (!item) return;
  const title = document.getElementById('inbox-task-title').value.trim();
  const project = document.getElementById('inbox-project').value;
  const estimate = document.getElementById('inbox-estimate').value.trim();
  const due = document.getElementById('inbox-due').value.trim();
  if (!title || parseEstimateHours(estimate) <= 0) {
    showToast('请填写任务标题和预计时长（例如 2h 或 30m）');
    return;
  }
  const id = newRecordId('task');
  const sourceId = newRecordId('source');
  DB.sourceItems = DB.sourceItems || [];
  DB.sourceItems.push({
    id: sourceId, raw: item.raw, source: item.source, person: item.person,
    createdAt: new Date().toISOString()
  });
  addConfirmedTask({
    id, title, project: project || null, estimate, due,
    priority: item.priority || 'P2', sourceId, done: false, createdAt: new Date().toISOString()
  }, DB.meta.today, ['P0', 'P1'].includes(item.priority) ? 'must' : 'should');
  DB.inboxArchive = DB.inboxArchive || [];
  DB.inboxArchive.push({ ...item, confirmedTask: id, confirmedAt: new Date().toISOString() });
  DB.inbox = DB.inbox.filter(i => i.id !== item.id);
  state.inboxId = DB.inbox[0]?.id || null;
  render();
  try {
    await persistWorkbench();
    showToast('已加入今日，收件箱原文已归档');
  } catch (error) { /* Persistence error is displayed by the storage adapter. */ }
}
