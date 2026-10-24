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

function workTaskStatus(task) {
  return task.done ? 'done' : task.blocked ? 'blocked' : task.status === '进行中' ? 'doing' : 'todo';
}

function taskWorkProgress(task) {
  return task.done ? 100 : Math.min(99, Math.max(0, Number(task.progress) || 0));
}

function taskWorkValues(task) {
  return task.workItems?.length ? task.workItems.map(taskWorkProgress) : [taskWorkProgress(task)];
}

function setWorkTaskStatus(task, status, progress) {
  for (const item of task.workItems || []) setWorkTaskStatus(item, status, progress);
  const previousCompletion = task.done && task.completedAt ? new Date(task.completedAt) : null;
  task.done = status === 'done';
  task.blocked = status === 'blocked';
  task.status = { todo: '待开始', doing: '进行中', blocked: '阻塞', done: '已完成' }[status];
  task.progress = task.done ? 100 : progress === undefined ? task.progress >= 100 ? 0 : taskWorkProgress(task) : Math.min(99, progress);
  task.completedAt = task.done ? task.completedAt || new Date().toISOString() : null;
  task.completedDate = task.done ? task.completedDate ||
    (previousCompletion && Number.isFinite(previousCompletion.getTime()) ? toISODate(previousCompletion) : DB.meta.today) : null;
  task.overdue = isTaskOverdue(task);
  if ((task.done || task.blocked) && DB.runningTimer?.taskId === task.id) stopTaskTimer();
}

function milestoneTaskIds(projectId, milestone) {
  return [...new Set([...(milestone.taskIds || []), ...allWorkbenchTasks()
    .filter(task => milestone.id && task.project === projectId && task.milestoneId === milestone.id).map(task => task.id)])];
}

function projectMilestones(projectId) {
  const project = projectById(projectId);
  if (!project) return [];
  return (detailForProject(project).milestones || []).filter(item => !(item.id === `milestone-${projectId}` &&
    ['未安排', '待安排'].includes(item.name) && ['', '—', undefined].includes(item.date) &&
    !item.note && !milestoneTaskIds(projectId, item).length));
}

function reconcileProjectWork(projectIds) {
  for (const id of new Set(projectIds.filter(Boolean))) {
    const project = projectById(id);
    if (!project) continue;
    const tasks = allWorkbenchTasks().filter(task => task.project === id);
    DB.projectDetails[id] ||= detailForProject(project);
    const milestones = projectMilestones(id);
    for (const milestone of milestones) {
      const ids = milestoneTaskIds(id, milestone);
      if (!ids.length) continue;
      const linked = ids.map(taskId => tasks.find(task => task.id === taskId));
      const linkedValues = linked.flatMap(task => task ? taskWorkValues(task) : [0]);
      milestone.progress = Math.round(linkedValues.reduce((sum, value) => sum + value, 0) / linkedValues.length);
      const done = linked.every(task => task?.done);
      milestone.status = done ? 'done' : linked.some(task => task && (task.blocked || isTaskOverdue(task))) ? 'risk' : 'open';
      milestone.completedAt = done ? milestone.completedAt || new Date().toISOString() : null;
    }
    project.open = tasks.filter(task => !task.done).length;
    project.progressSource = tasks.length ? 'tasks' : 'milestones';
    const values = tasks.length ? tasks.flatMap(taskWorkValues) : milestones.map(item => item.status === 'done' ? 100 : item.progress || 0);
    const complete = values.length > 0 && tasks.every(task => task.done) && milestones.every(item => item.status === 'done');
    project.progress = values.length ? Math.min(complete ? 100 : 99, Math.round(values.reduce((a, b) => a + b, 0) / values.length)) : 0;
    project.status = complete ? '已完成' : tasks.some(task => task.done || task.blocked || task.status === '进行中' || taskWorkProgress(task) > 0) ||
      milestones.some(item => item.status === 'done') ? '进行中' : '待开始';
    project.completedAt = complete ? project.completedAt || new Date().toISOString() : null;
    const next = milestones.find(item => item.status !== 'done');
    const nextTask = tasks.find(task => !task.done);
    project.next = next?.name || (complete ? '项目已完成' : nextTask?.title || '未安排');
    project.nextDate = next?.date || (nextTask ? taskDeadlineDate(nextTask) || '—' : '—');
    project.updated = '刚刚';
    for (const doc of DB.documents || []) {
      for (const draft of doc.analysis?.tasks || []) {
        const task = tasks.find(item => item.id === draft.taskId);
        if (task) Object.assign(draft, { done: !!task.done, status: task.status, progress: taskWorkProgress(task) });
      }
    }
    for (const waiting of DB.waiting || []) {
      const task = tasks.find(item => item.id === waiting.taskId);
      if (task) waiting.status = task.done ? 'done' : 'open';
    }
  }
  updateTaskCapacity();
}

function toggleTask(id) {
  if (!id) return;
  const task = [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could,
    ...Object.values(DB.taskCalendar || {}).flat()].find(t => t.id === id);
  if (!task) return;
  setWorkTaskStatus(task, task.done ? 'todo' : 'done');
  reconcileProjectWork([task.project]);
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
  if (projectById(task.project)?.progressSource) reconcileProjectWork([task.project]);
}

function readProjectStakeholders() {
  const list = document.getElementById('project-stakeholder-list');
  if (!list) return null;
  return [...list.querySelectorAll('[data-stakeholder-id]')].map(row => ({
    ...state.projectStakeholderDraft?.find(person => person.id === row.dataset.stakeholderId),
    id: row.dataset.stakeholderId,
    name: row.querySelector('[data-stakeholder-name]').value.trim(),
    role: row.querySelector('[data-stakeholder-role]').value.trim()
  }));
}

async function saveProject() {
  const name = document.getElementById('project-name').value.trim();
  const progressInput = document.getElementById('project-progress');
  const progress = Number(progressInput.value);
  if (!name || !progressInput.value || !progressInput.checkValidity() || !Number.isFinite(progress)) {
    if (!name) document.getElementById('project-name').focus?.();
    else {
      const advanced = progressInput.closest?.('details');
      if (advanced) advanced.open = true;
      progressInput.focus?.();
    }
    showToast('请填写项目名称，进度须为 0 到 100 的整数');
    return;
  }
  const existing = state.editProjectId ? projectById(state.editProjectId) : null;
  if (state.editProjectId && !existing) { showToast('项目已不存在'); return; }
  const stakeholders = readProjectStakeholders();
  if (stakeholders) {
    const invalid = stakeholders.findIndex(person => !person.name || person.name.length > 80 || person.role.length > 80);
    const error = document.getElementById('project-stakeholder-error');
    if (error) error.hidden = invalid < 0;
    if (invalid >= 0) {
      const message = `请填写第 ${invalid + 1} 位干系人的姓名，姓名和角色均不超过 80 字`;
      if (error) error.textContent = message;
      document.querySelectorAll('[data-stakeholder-name]')[invalid].focus();
      showToast(message);
      return;
    }
  }
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
    updated: '刚刚', customValues: { ...existing?.customValues, ...readCustomFields('project') }
  };
  if (stakeholders) {
    const detail = detailForProject(project);
    DB.projectDetails[project.id] = {
      ...detail,
      stakeholders: stakeholders.map(person => ({
        ...person, role: person.role || '项目成员',
        i: deriveInitials(person.name), c: person.c || project.color
      }))
    };
  }
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
  (DB.documents || []).forEach(doc => {
    if (doc.projectId === id) {
      doc.previousProjectId = id;
      doc.projectId = null;
      if (doc.analysis) { doc.analysis.projectId = null; doc.analysis.proposedProjectId = ''; }
    }
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
  const p90 = document.getElementById('inbox-p90')?.value.trim() || item.p90;
  const type = document.getElementById('inbox-type')?.value || item.type;
  if (!title || parseEstimateHours(estimate) <= 0 || parseEstimateHours(p90) < parseEstimateHours(estimate)) {
    showToast('请填写标题和有效时长，P90 不得小于 P50（例如 2h 或 30m）');
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
    priority: item.priority || 'P2', p90, type, sourceId, done: false, createdAt: new Date().toISOString()
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
