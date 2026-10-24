/* One work update commits tasks, milestones and all derived views together. */
const workUpdatesInFlight = new Set();
function canAutoSyncWork(text) {
  if (/[?？]|如果|假如|假设|是否|能否|如何|怎么|什么|请问|解释|分析|总结|完成后|完成了吗|先不|暂不|不要|别修改|吗[。！\s]*$/.test(text)) return false;
  return /完成|做完|搞定|弄好|修好|结束|进行中|正在.*(?:推进|部署|处理)|阻塞|卡住|重新打开|重新开始|还没完成|尚未完成|记录|备注|已.*(?:确认|沟通|提交|交付)|进度.*\d+\s*%/.test(text);
}

function workUpdateReferences(updates, context) {
  const projects = new Set(updates.map(action => action.projectId));
  return {
    tasks: context.tasks.filter(task => projects.has(task.projectId)),
    milestones: context.milestones.filter(item => projects.has(item.projectId))
  };
}

function modelWorkUpdateCard(updates, raw, context = modelChatContext()) {
  updates = [...new Set(updates.map(action => action.projectId))].map(projectId => ({
    projectId, type: 'work_update',
    note: updates.filter(action => action.projectId === projectId).map(action => action.note).filter(Boolean).join('\n'),
    tasks: updates.filter(action => action.projectId === projectId).flatMap(action => action.tasks),
    milestones: updates.filter(action => action.projectId === projectId).flatMap(action => action.milestones)
  }));
  const items = [];
  for (const action of updates) {
    const project = projectById(action.projectId);
    for (const update of action.tasks) {
      const task = context.tasks.find(item => item.id === update.taskId);
      items.push({ label: project?.name || '项目已移除', value: `${task?.title || '任务已移除'} → ${
        { todo: '待开始', doing: '进行中', blocked: '阻塞', done: '已完成' }[update.status]}` });
      if (update.note) items.push({ label: '任务备注', value: update.note });
    }
    if (action.note) items.push({ label: '项目备注', value: action.note });
    for (const update of action.milestones) {
      const milestone = context.milestones.find(item => item.id === update.milestoneId);
      items.push({ label: '里程碑', value: `${milestone?.name || '节点已移除'} → ${update.status === 'done' ? '已完成' : update.status === 'risk' ? '有风险' : '未完成'}` });
    }
  }
  items.push({ label: '同步范围', value: '项目进度、下一节点、今日安排、逾期提醒、附件任务与报表' });
  return { id: newRecordId('action'), type: 'work_update', title: '同步工作状态',
    status: 'pending', modelAction: true, raw, updates, items, expected: workUpdateReferences(updates, context) };
}

function validateWorkUpdateCard(card) {
  const live = workUpdateReferences(card.updates, modelChatContext());
  if (JSON.stringify(live) !== JSON.stringify(card.expected)) throw new Error('任务或里程碑已变更，请重新说明最新状态后同步');
  const seenTasks = new Set(), seenMilestones = new Set();
  for (const action of card.updates) {
    if (!projectById(action.projectId)) throw new Error('关联项目已删除，未更新任何任务');
    for (const update of action.tasks) {
      const task = taskLocation(update.taskId)?.task;
      if (!task || task.project !== action.projectId || seenTasks.has(task.id)) throw new Error('任务归属变更或重复，未更新任何任务');
      if (!['todo', 'doing', 'blocked', 'done'].includes(update.status)) throw new Error('任务状态无效');
      seenTasks.add(task.id);
    }
    for (const update of action.milestones) {
      const milestone = DB.projectDetails[action.projectId]?.milestones.find(item => item.id === update.milestoneId);
      if (!milestone || seenMilestones.has(milestone.id)) throw new Error('里程碑已变更或重复，未更新任何任务');
      if (!['open', 'risk', 'done'].includes(update.status)) throw new Error('里程碑状态无效');
      seenMilestones.add(milestone.id);
      const ids = [...new Set([...milestoneTaskIds(action.projectId, milestone), ...(update.taskIds || [])])];
      if (ids.some(id => taskLocation(id)?.task.project !== action.projectId)) throw new Error('里程碑包含已移除或跨项目任务');
      if (update.status === 'done' && ids.some(id => {
        const planned = card.updates.flatMap(item => item.tasks).find(task => task.taskId === id);
        return planned ? planned.status !== 'done' : !taskLocation(id)?.task.done;
      })) throw new Error('该里程碑仍有关联任务未完成，未更新任何任务');
    }
  }
}

function applyWorkUpdateCard(card) {
  validateWorkUpdateCard(card);
  const summaries = [];
  const timestamp = new Date().toISOString();
  for (const action of card.updates) {
    const project = projectById(action.projectId);
    const before = project.progress;
    let changed = false;
    for (const update of action.tasks) {
      const task = taskLocation(update.taskId).task;
      if (update.status !== workTaskStatus(task) ||
          (update.progress !== undefined && update.progress !== taskWorkProgress(task))) {
        changed = true;
        setWorkTaskStatus(task, update.status, update.progress);
      }
      appendTaskNote(task, update.note || `${{ todo: '待开始', doing: '进行中', blocked: '阻塞', done: '已完成' }[workTaskStatus(task)]}，完成进度 ${taskWorkProgress(task)}%。`,
        { raw: card.raw, source: '对话任务备注', updateId: card.id, createdAt: timestamp,
          status: workTaskStatus(task), progress: taskWorkProgress(task) });
    }
    for (const update of action.milestones) {
      const milestone = DB.projectDetails[project.id].milestones.find(item => item.id === update.milestoneId);
      if (milestone.status !== update.status || update.taskIds?.some(id => !milestoneTaskIds(project.id, milestone).includes(id))) changed = true;
      if (update.taskIds) milestone.taskIds = [...new Set([...milestoneTaskIds(project.id, milestone), ...update.taskIds])];
      milestone.status = update.status;
      milestone.completedAt = update.status === 'done' ? milestone.completedAt || new Date().toISOString() : null;
    }
    if (changed) reconcileProjectWork([project.id]);
    const tasks = allWorkbenchTasks().filter(task => task.project === project.id);
    const milestones = projectMilestones(project.id);
    const statuses = ['done', 'doing', 'blocked', 'todo'].map(status => {
      const count = action.tasks.filter(task => task.status === status).length;
      return count ? `${{ done: '已完成', doing: '进行中', blocked: '阻塞', todo: '待开始' }[status]} ${count} 项` : '';
    }).filter(Boolean).join('、');
    summaries.push(!action.tasks.length && !action.milestones.length ? `${project.name}：已追加项目备注。\n${action.note}` :
      `${project.name}：已同步 ${action.tasks.length} 项任务${statuses ? `（${statuses}）` : ''}${action.milestones.length ? `、${action.milestones.length} 个里程碑` : ''}。\n` +
      `任务 ${tasks.filter(task => task.done).length}/${tasks.length} 已完成；里程碑 ${milestones.filter(item => item.status === 'done').length}/${milestones.length} 已完成。\n` +
      `项目进度 ${before}% → ${project.progress}%（按${tasks.length ? '任务' : '里程碑'}完成比例${project.progress === 99 && tasks.every(task => task.done) ? '，尚有里程碑未完成' : ''}）。` +
      (project.next !== '项目已完成' ? `下一步：${project.next}。` : '项目已完成。'));
    appendProjectNote(project.id, action.note || summaries.at(-1), { raw: card.raw,
      source: '对话状态同步', createdAt: timestamp, updateId: card.id });
    DB.projectDetails[project.id] ||= detailForProject(project);
    DB.projectDetails[project.id].activity ||= [];
    DB.projectDetails[project.id].activity.unshift({ time: noteTimestamp({ createdAt: timestamp }),
      text: action.note || summaries.at(-1), tone: 'green', updateId: card.id });
  }
  return summaries.join('\n\n') + '\n进展备注已按时间保存。';
}

async function applyWorkUpdateMessage(message, automatic = false) {
  const card = message.actionCard;
  if (!card || card.status !== 'pending' || workUpdatesInFlight.has(card.id)) return;
  const backup = JSON.stringify(DB);
  const previousText = message.text;
  const previousItems = JSON.parse(JSON.stringify(card.items));
  workUpdatesInFlight.add(card.id);
  try {
    const summary = applyWorkUpdateCard(card);
    message.text = summary;
    card.status = 'done';
    card.title = '工作状态已同步';
    saveProjectNotes();
    saveChatHistory();
    await persistWorkbench();
    showToast('工作状态与项目进度已同步');
  } catch (error) {
    const snapshot = JSON.parse(backup);
    for (const key of Object.keys(DB)) if (!Object.hasOwn(snapshot, key)) delete DB[key];
    Object.assign(DB, snapshot);
    card.status = 'pending';
    card.items = previousItems;
    card.title = '工作状态尚未同步';
    message.text = `${automatic ? '自动同步未完成' : '同步失败'}：${error.message}。\n${previousText === '正在同步工作状态。' ? '请检查后重试，未保留本次状态变更。' : previousText}`;
    saveProjectNotes();
    saveChatHistory();
    // Replace any failed queued snapshot with the restored state.
    await persistWorkbench().catch(() => {});
  } finally {
    workUpdatesInFlight.delete(card.id);
    render();
    scrollChatToBottom();
  }
}
