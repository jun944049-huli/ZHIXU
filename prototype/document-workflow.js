/* Related work keeps its original records inside a single actionable task. */
function restoreDocumentSnapshot(snapshot) {
  for (const key of Object.keys(DB)) if (!Object.hasOwn(snapshot, key)) delete DB[key];
  Object.assign(DB, snapshot);
}

function documentTaskIds(task) {
  return [...new Set([task.taskId, ...(task.mergeTaskIds || [])].filter(Boolean))];
}

function validateDocumentMerge(ids) {
  const records = ids.map(id => taskLocation(id)?.task);
  if (records.some(record => !record)) throw new Error('部分任务已移除，请重新打开附件');
  if (new Set(records.map(task => task.project)).size > 1) throw new Error('不同项目的任务不能合并');
  for (const key of ['assignee', 'due']) {
    const values = records.map(task => task[key]).filter(value => value && value !== '待确认');
    if (new Set(values).size > 1) throw new Error('不同负责人或截止日期的任务请分别保留');
  }
  const memberships = records.map(task => projectMilestones(task.project)
    .filter(item => milestoneTaskIds(task.project, item).includes(task.id)).map(item => item.id).sort().join('|'));
  if (new Set(memberships).size > 1) throw new Error('不同里程碑的任务请分别保留');
  return records;
}

function combineDocumentTasks(tasks, title) {
  const ids = [...new Set(tasks.flatMap(documentTaskIds))];
  if (ids.length) validateDocumentMerge(ids);
  const values = key => [...new Set(tasks.map(task => task[key]).filter(Boolean))];
  if (values('assignee').length > 1 || values('due').length > 1) {
    throw new Error('不同负责人或截止日期的任务请分别保留');
  }
  const estimateHours = tasks.reduce((sum, task) => sum + (Number(task.estimateHours) || 0), 0);
  if (estimateHours > 200) throw new Error('合并后工时超过 200 小时，请按阶段分别保留');
  const details = [...new Set(tasks.map(task => [task.title, task.details].filter(Boolean).join('\n')))].join('\n\n');
  if (details.length > 12000) throw new Error('详细清单超过 12000 字，请分组整理');
  return { ...(tasks.find(task => task.taskId) || tasks[0]), id: newRecordId('draft'),
    title: title || tasks[0].title, details,
    evidence: [...new Set(tasks.map(task => task.evidence).filter(Boolean))].join('\n'),
    taskId: ids[0], mergeTaskIds: ids.slice(1), selected: true,
    assignee: values('assignee')[0] || '', due: values('due')[0] || '',
    priority: tasks.map(task => task.priority).sort()[0], estimateHours: Math.round(estimateHours * 10) / 10 };
}

function prepareDocumentAnalysis(result, previous = []) {
  const available = new Set(previous.flatMap(documentTaskIds));
  const claimed = new Set();
  const tasks = result.tasks.map(task => {
    const requested = task.sourceTaskIds || [];
    if (!requested.length && previous.some(item => documentTaskIds(item).some(id => claimed.has(id)) &&
        task.evidence && (item.evidence || '').includes(task.evidence))) return null;
    if (requested.some(id => !available.has(id))) throw new Error('分析引用了不属于此附件的任务，请重新分析');
    let sources = previous.filter(item => documentTaskIds(item).some(id => requested.includes(id)));
    if (!requested.length) {
      const exact = previous.filter(item => item.taskId && !claimed.has(item.taskId) &&
        (item.title === task.title || item.evidence === task.evidence ||
          (task.evidence && (item.evidence || '').includes(task.evidence))));
      if (exact.length === 1) sources = exact;
    }
    const ids = [...new Set(sources.flatMap(documentTaskIds))];
    for (const id of ids) {
      if (claimed.has(id)) throw new Error('同一任务被重复分组，请重新分析');
      claimed.add(id);
    }
    const combined = sources.length ? combineDocumentTasks(sources, task.title) : {};
    return { ...task, ...combined, title: task.title, id: newRecordId('draft'), selected: true,
      details: [...new Set([task.details, combined.details].filter(Boolean))].join('\n\n') };
  }).filter(Boolean);
  for (const task of previous) {
    if (task.taskId && !documentTaskIds(task).some(id => claimed.has(id))) tasks.push(task);
  }
  if (tasks.length > 80) throw new Error('合并后超过 80 条任务，请分批整理');
  return { ...result, tasks };
}

function mergeSelectedDocumentTasks() {
  try {
    const draft = readDocumentDraft();
    const selected = draft.tasks.filter((_task, index) => document.getElementById(`draft-merge-${index}`)?.checked);
    if (selected.length < 2) throw new Error('请至少选择两个相关任务');
    const title = fieldValue('document-merge-title');
    if (!title) throw new Error('请填写合并后的简短标题');
    const combined = combineDocumentTasks(selected, title);
    const first = draft.tasks.indexOf(selected[0]);
    draft.tasks = draft.tasks.filter(task => !selected.includes(task));
    draft.tasks.splice(first, 0, combined);
    openDocumentEditor(state.documentId, true);
  } catch (error) { showToast(error.message); }
}

function mergeDocumentWorkRecords(task, doc) {
  const ids = documentTaskIds(task);
  if (ids.length < 2) return;
  const records = validateDocumentMerge(ids);
  if (records.some(record => record.sourceDocumentId !== doc.id)) throw new Error('只能合并此附件生成的任务');
  const primary = records[0];
  const history = records.flatMap(taskNotesFor);
  const items = JSON.parse(JSON.stringify(records.flatMap(record => record.workItems?.length ? record.workItems : [record])));
  primary.workItems = items;
  primary.noteHistory = [...new Map(history.map(note => [note.id, note])).values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const complete = items.every(item => item.done);
  primary.done = complete;
  primary.blocked = !complete && items.some(item => item.blocked);
  primary.status = complete ? '已完成' : primary.blocked ? '阻塞' :
    items.some(item => item.done || item.status === '进行中') ? '进行中' : '待开始';
  primary.progress = Math.round(items.reduce((sum, item) => sum + taskWorkProgress(item), 0) / items.length);
  primary.completedAt = complete ? items.map(item => item.completedAt).filter(Boolean).sort().at(-1) : null;
  primary.completedDate = complete ? items.map(item => item.completedDate).filter(Boolean).sort().at(-1) : null;
  const removed = new Set(ids.slice(1));
  if (removed.has(DB.runningTimer?.taskId)) stopTaskTimer();
  for (const id of removed) {
    const found = taskLocation(id);
    found.list.splice(found.index, 1);
  }
  for (const detail of Object.values(DB.projectDetails)) for (const milestone of detail.milestones || []) {
    if (milestone.taskIds) milestone.taskIds = [...new Set(milestone.taskIds.map(id => removed.has(id) ? primary.id : id))];
  }
  for (const entry of [...(DB.waiting || []), ...(DB.timeEntries || [])]) {
    if (removed.has(entry.taskId)) entry.taskId = primary.id;
  }
  for (const other of DB.documents) for (const candidate of other.analysis?.tasks || []) {
    if (removed.has(candidate.taskId)) candidate.taskId = primary.id;
  }
  task.taskId = primary.id;
  task.mergeTaskIds = [];
}

function publishDocumentSummary(doc) {
  ensureChat();
  const tasks = (doc.analysis?.tasks || []).filter(task => task.selected !== false);
  const project = projectById(doc.projectId);
  const status = doc.analysisPending ? '分析已更新，等待保存' : project ? `已保存到「${project.name}」` : '项目归属待确认';
  const message = { role: 'assistant', documentId: doc.id, time: '现在',
    model: doc.analysis?.model || doc.analysis?.mode || '系统',
    text: `${doc.title}\n${status} · ${tasks.length} 项任务\n${(doc.analysis?.summary || doc.parseError || '分析未完成，请查看附件详情。').slice(0, 500)}`,
    documentTasks: tasks.map(task => ({ title: task.title })).slice(0, 8) };
  const previous = state.chatMessages.find(item => item.documentId === doc.id);
  if (previous) Object.assign(previous, message);
  else state.chatMessages.push(message);
  saveChatHistory();
}

function returnDocumentToChat() {
  closeModal();
  state.view = 'chat';
  render();
  scrollChatToBottom();
}

function openDocumentChatDetails(id) {
  const doc = documentById(id);
  if (doc && projectById(doc.projectId)) {
    state.projectId = doc.projectId;
    state.projectTab = 'tasks';
    state.view = 'project';
    render();
  }
  openDocumentEditor(id);
}
