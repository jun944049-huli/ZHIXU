import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

function workbench() {
  const fields: Record<string, { value: string; checkValidity(): boolean }> = {};
  const saved: unknown[] = [];
  const preferences: Record<string, string> = {};
  const context = createContext({
    crypto: webcrypto, console, setTimeout, clearTimeout,
    window: {},
    storageGet: () => null,
    storageSet: (key: string, value: string) => { preferences[key] = value; },
    document: { getElementById: (id: string) => fields[id] || null, querySelector: () => null },
    render: () => {}, closeModal: () => {}, showToast: () => {},
    scrollChatToBottom: () => {},
    persistWorkbench: async () => { saved.push(runInContext('JSON.stringify(DB)', context)); }
  });
  for (const file of ['data.js', 'shared.js', 'views-chat.js', 'views-project.js', 'views-output.js',
    'operations.js', 'integrations.js', 'features.js', 'analytics.js', 'documents.js']) {
    runInContext(readFileSync(resolve('prototype', file), 'utf8'), context, { filename: file });
  }
  runInContext('initializeIntegrations(); initializeFeatures();', context);
  return {
    run: (code: string) => runInContext(code, context),
    fields, saved, preferences
  };
}

test('project removal preserves linked tasks across all dates and archives notes', async () => {
  const w = workbench();
  const before = w.run('allWorkbenchTasks().length');
  w.run("DB.documents.push({id:'linked-doc',projectId:'p1',content:'保留附件正文',analysis:{projectId:'p1'}})");
  w.run("projectNotesFor('p1').push({ text: '原始记录' }); state.deleteProjectId = 'p1'; state.chatContext = 'p1'");
  await w.run('deleteProject()');
  assert.equal(w.run("projectById('p1')"), null);
  assert.equal(w.run('allWorkbenchTasks().length'), before);
  assert.equal(w.run("allWorkbenchTasks().some(t => t.project === 'p1')"), false);
  assert.equal(w.run("DB.inbox.some(t => t.project === 'p1')"), false);
  assert.equal(w.run("DB.waiting.some(t => t.project === 'p1')"), false);
  assert.equal(w.run("DB.projectArchive[0].notes.some(n => n.text === '原始记录')"), true);
  assert.equal(w.run('state.chatContext'), 'auto');
  assert.equal(JSON.parse(w.preferences['jw-project-notes']).p1, undefined);
  assert.equal(w.saved.length, 1);
  assert.equal(w.run("documentById('linked-doc').projectId"), null);
  assert.equal(w.run("documentById('linked-doc').content"), '保留附件正文');
});

test('model chat is a real bridge call, retains failed questions and retries without local fallback', async () => {
  const w = workbench();
  w.fields['chat-input'] = { value: '解释关键路径', checkValidity: () => true };
  const before = w.run('DB.inbox.length');
  w.run(`DB.settings.aiProvider='custom'; DB.settings.customProvider={
    name:'验收模型',baseUrl:'http://127.0.0.1',apiKey:'secret',model:'semantic-model',protocol:'responses'};
    window.xiaoyuDesktop={chat:async payload=>{
      window.lastPayload=payload;
      return {reply:'关键路径决定最早交付时间',actions:[],warnings:[],model:'semantic-model'};
    }};`);
  await w.run('sendChat()');
  assert.equal(w.run('state.chatMessages.at(-1).text'), '关键路径决定最早交付时间');
  assert.equal(w.run('window.lastPayload.provider.model'), 'semantic-model');
  assert.equal(w.run('window.lastPayload.messages.at(-1).content'), '解释关键路径');
  assert.equal(w.run('DB.inbox.length'), before);
  assert.equal(w.run('chatModelLabel()'), '验收模型 · semantic-model');
  w.run("window.xiaoyuDesktop.chat=async()=>{throw new Error('HTTP 401: 鉴权失败')}");
  w.fields['chat-input'].value = '再解释一下';
  await w.run('sendChat()');
  assert.match(w.run('state.chatMessages.at(-1).text'), /401/);
  assert.equal(w.run('state.chatMessages.at(-1).actionCard'), undefined);
  assert.equal(w.run('state.chatSending'), false);
  const id = w.run('state.chatMessages.at(-1).retryOf');
  w.run("window.xiaoyuDesktop.chat=async()=>({reply:'恢复后的模型回答',actions:[],warnings:[],model:'semantic-model'})");
  await w.run(`sendChat(${JSON.stringify(id)})`);
  assert.equal(w.run("state.chatMessages.filter(m=>m.role==='user' && m.text==='再解释一下').length"), 1);
  assert.equal(w.run('state.chatMessages.at(-1).text'), '恢复后的模型回答');
  assert.equal(w.run('state.chatMessages.some(m=>m.retryOf)'), false);
  assert.equal(w.run('DB.inbox.length'), before);
});

test('model proposals create tasks, risks and projects only on explicit, idempotent confirmation', async () => {
  const w = workbench();
  const tasks = w.run('allWorkbenchTasks().length'), projects = w.run('DB.projects.length');
  w.run(`state.chatMessages=[{actionCard:modelChatCard({
    type:'task',title:'语义验收',projectId:'p1',date:'2030-02-05',due:'2030-02-06',
    assignee:'小陈',estimateHours:0,priority:'P2'},'明天交给小陈验收')}];`);
  assert.equal(w.run('allWorkbenchTasks().length'), tasks);
  await w.run('applyChatAction()');
  await w.run('applyChatAction()');
  assert.equal(w.run('allWorkbenchTasks().length'), tasks + 1);
  assert.equal(w.run("DB.taskCalendar['2030-02-05'][0].assignee"), '小陈');
  assert.equal(w.run("DB.taskCalendar['2030-02-05'][0].estimate"), '待估时');
  assert.equal(w.run("DB.taskCalendar['2030-02-05'][0].due"), '2030-02-06');
  w.run(`state.chatMessages=[{actionCard:modelChatCard({
    type:'risk',projectId:'p1',title:'新的供应风险',level:'低'},'记录低风险')}];`);
  await w.run('applyChatAction()');
  assert.equal(w.run("DB.projectDetails.p1.risks.find(r=>r.title==='新的供应风险').level"), '低');
  w.run("state.chatMessages=[{actionCard:modelChatCard({type:'project',name:'语义新项目',goal:'验收',owner:'小陈'},'建项目')}];");
  assert.equal(w.run('DB.projects.length'), projects);
  await w.run('applyChatAction()');
  await w.run('applyChatAction()');
  assert.equal(w.run('DB.projects.length'), projects + 1);
  assert.equal(w.run("DB.projects.at(-1).owner"), '小陈');
});

test('removing the last project leaves both portfolio and stale detail routes usable', async () => {
  const w = workbench();
  await w.run('(async () => { for (const p of [...DB.projects]) { state.deleteProjectId = p.id; await deleteProject(); } })()');
  assert.equal(w.run('DB.projects.length'), 0);
  assert.match(w.run('renderProjects()'), /暂无项目/);
  assert.match(w.run('renderProject()'), /暂无项目/);
});

test('project forms validate, create and edit the same persisted project', async () => {
  const w = workbench();
  for (const [key, value] of Object.entries({
    name: '', code: 'QA', owner: 'Tester', goal: '<script>test</script>',
    progress: '0', health: 'green', next: '', 'next-date': ''
  })) w.fields['project-' + key] = { value, checkValidity: () => true };
  await w.run('saveProject()');
  assert.equal(w.run('DB.projects.length'), 6);
  w.fields['project-name'].value = '验收项目';
  await w.run('saveProject()');
  const id = w.run('state.projectId');
  assert.equal(w.run('DB.projects.length'), 7);
  assert.match(w.run('renderProject()'), /&lt;script&gt;test&lt;\/script&gt;/);
  w.run(`state.editProjectId = ${JSON.stringify(id)}`);
  w.fields['project-name'].value = '已修改项目';
  w.fields['project-progress'].value = '65';
  await w.run('saveProject()');
  assert.equal(w.run('DB.projects.length'), 7);
  assert.equal(w.run('projectById(state.projectId).progress'), 65);
  assert.equal(w.run('projectById(state.projectId).name'), '已修改项目');
});

test('project task lists merge live records and reflect completion across calendar dates', () => {
  const w = workbench();
  w.run(`state.projectId = 'p1'; state.projectTab = 'tasks';
    DB.taskCalendar['2030-01-01'] = [{ id: 'future', project: 'p1', title: '未来完成任务',
      done: true, priority: 'P4', estimate: '1h', due: '2030-01-01' }];
    DB.tasks.could.push({ id: 'could', project: 'p1', title: '低优先级任务', priority: 'P4' });`);
  const html = w.run('renderProject()');
  assert.match(html, /未来完成任务/);
  assert.match(html, /已完成/);
  assert.match(html, /低优先级任务/);
});

test('progress updates work with an empty day and accept zero percent', async () => {
  const w = workbench();
  w.run("DB.tasks.must = []; state.chatMessages = [buildChatReply('星火项目进度更新到 0%')]");
  await w.run('applyChatAction()');
  assert.equal(w.run("projectById('p1').progress"), 0);
});

test('confirming the selected chat draft writes its inbox record exactly once', async () => {
  const w = workbench();
  const before = w.run('DB.inbox.length');
  w.run(`state.chatMessages = [
    { actionCard: { id: 'first', type: 'capture', status: 'pending', raw: '第一条原文' } },
    { actionCard: { id: 'second', type: 'capture', status: 'pending', raw: '第二条原文' } }
  ]`);
  await w.run("applyChatAction('', 'first')");
  await w.run("applyChatAction('', 'first')");
  assert.equal(w.run('DB.inbox.length'), before + 1);
  assert.equal(w.run('DB.inbox[0].raw'), '第一条原文');
  assert.equal(w.run("state.chatMessages[1].actionCard.status"), 'pending');
});

test('new projects match by name and deleted project drafts cannot modify work', async () => {
  const w = workbench();
  w.run(`DB.projects.push({ id: 'custom', name: '测试自建项目' });
    state.chatMessages = [buildChatReply('测试自建项目：安排测试任务')];`);
  assert.equal(w.run("matchProjectByText('测试自建项目：安排测试任务').id"), 'custom');
  assert.equal(w.run('state.chatMessages[0].actionCard.type'), 'task');
  const before = w.run('allWorkbenchTasks().length');
  w.run("DB.projects = DB.projects.filter(p => p.id !== 'custom')");
  await w.run('applyChatAction()');
  assert.equal(w.run('allWorkbenchTasks().length'), before);
});

test('old prototype connections do not appear as verified without saved credentials', () => {
  const w = workbench();
  w.run('initializeIntegrations()');
  assert.equal(w.run("integrationStatus('feishu').on"), false);
  assert.equal(w.run("integrationStatus('ics').label"), '未配置');
  assert.equal(w.run("integrationStatus('manual').on"), true);
  assert.equal(w.run("integrationStatus('github').label"), '尚未接入');
});

test('connector imports deduplicate pending and already-confirmed inbox records', () => {
  const w = workbench();
  w.run('initializeIntegrations()');
  assert.equal(w.run("importIntegrationRecords('ics', [{ externalId: 'event-1', title: '会议', raw: '原始日程' }])"), 1);
  assert.equal(w.run("importIntegrationRecords('ics', [{ externalId: 'event-1', title: '会议', raw: '原始日程' }])"), 0);
  w.run("DB.inboxArchive = [DB.inbox.shift()]");
  assert.equal(w.run("importIntegrationRecords('ics', [{ externalId: 'event-1', title: '会议', raw: '原始日程' }])"), 0);
  assert.equal(w.run('DB.inboxArchive[0].raw'), '原始日程');
});

test('moving a task removes the previous date and preserves identity and inactive custom values', async () => {
  const w = workbench();
  w.run("DB.tasks.must[0].customValues = { hidden: '保留旧值' }; state.editTaskId = DB.tasks.must[0].id");
  const id = w.run('state.editTaskId');
  for (const [key, value] of Object.entries({
    title: '改期验收', project: 'p2', date: '2030-01-01', due: '2030-01-02',
    hours: '2', priority: 'P3', assignee: 'Tester', note: '原有记录仍在'
  })) w.fields['task-' + key] = { value, checkValidity: () => true };
  const before = w.run('allWorkbenchTasks().length');
  await w.run('saveTaskEditor()');
  assert.equal(w.run('allWorkbenchTasks().length'), before);
  assert.equal(w.run(`tasksOnDate(DB.meta.today).some(t=>t.id===${JSON.stringify(id)})`), false);
  assert.equal(w.run(`taskLocation(${JSON.stringify(id)}).date`), '2030-01-01');
  assert.equal(w.run(`taskLocation(${JSON.stringify(id)}).task.customValues.hidden`), '保留旧值');
});

test('editing a timed task to completed stops timing and reopening clears the completion date', async () => {
  const w = workbench();
  w.run("state.editTaskId = 't1'");
  const task = w.run("taskLocation('t1').task");
  for (const [key, value] of Object.entries({
    title: task.title, project: task.project, date: w.run('DB.meta.today'), due: task.due,
    hours: '1', priority: 'P1', assignee: 'QA', note: '', status: 'done'
  })) w.fields['task-' + key] = { value: String(value || ''), checkValidity: () => true };
  await w.run("toggleTimer('t1')");
  w.run('DB.runningTimer.startedAt -= 120000');
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskLocation('t1').task.done"), true);
  assert.equal(w.run('DB.runningTimer'), null);
  assert.ok(w.run('DB.timeEntries[0].seconds') >= 120);
  w.fields['task-status'].value = 'doing';
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskLocation('t1').task.done"), false);
  assert.equal(w.run("taskLocation('t1').task.completedAt"), null);
  assert.equal(w.run("taskLocation('t1').task.status"), '进行中');
});

test('upgrading legacy project task details preserves records without duplicating on reload', () => {
  const w = workbench();
  w.run(`DB.projectDetails.p1.tasks = [{ title: '旧明细升级', priority: 'P2',
    status: '已完成', due: '12/01' }]; initializeFeatures()`);
  const count = w.run('allWorkbenchTasks().length');
  assert.equal(w.run("allWorkbenchTasks().find(t => t.title === '旧明细升级').done"), true);
  w.run('initializeFeatures()');
  assert.equal(w.run('allWorkbenchTasks().length'), count);
  assert.equal(w.run('DB.projectDetails.p1.tasks.length'), 0);
});

test('ignoring and restoring inbox records keeps source identity available for deduplication', async () => {
  const w = workbench();
  w.run("DB.inbox[0].connectorId = 'ics'; DB.inbox[0].externalId = 'stable-event'; archiveInbox([DB.inbox[0].id])");
  assert.equal(w.run("importIntegrationRecords('ics', [{externalId:'stable-event', title:'重复', raw:'原文'}])"), 0);
  await w.run("handleFeatureAction('inbox-restore', {dataset:{id:DB.inboxArchive[0].id}})");
  assert.equal(w.run("DB.inbox[0].externalId"), 'stable-event');
  assert.equal(w.run('DB.inboxArchive.length'), 0);
});

test('deleting an inbox record preserves its source, deduplicates syncs and can be restored', async () => {
  const w = workbench();
  const taskCount = w.run('allWorkbenchTasks().length');
  const inboxCount = w.run('DB.inbox.length');
  w.run("DB.inbox[0].connectorId='ics'; DB.inbox[0].externalId='deleted-event'");
  const id = w.run('DB.inbox[0].id');
  const raw = w.run('DB.inbox[0].raw');
  await w.run(`deleteInboxItem(${JSON.stringify(id)})`);
  await w.run(`deleteInboxItem(${JSON.stringify(id)})`);
  assert.equal(w.run('DB.inbox.length'), inboxCount - 1);
  assert.equal(w.run('DB.inboxArchive.length'), 1);
  assert.equal(w.run('DB.inboxArchive[0].raw'), raw);
  assert.ok(w.run('DB.inboxArchive[0].deletedAt'));
  assert.equal(w.run('allWorkbenchTasks().length'), taskCount);
  assert.equal(w.run("importIntegrationRecords('ics',[{externalId:'deleted-event',title:'重复',raw:'原文'}])"), 0);
  assert.equal(JSON.parse(String(w.saved[0])).inboxArchive[0].id, id);
  await w.run(`handleFeatureAction('inbox-restore',{dataset:{id:${JSON.stringify(id)}}})`);
  assert.equal(w.run('DB.inbox[0].id'), id);
  assert.equal(w.run('DB.inbox[0].deletedAt'), undefined);
  assert.equal(w.run('DB.inboxArchive.length'), 0);
});

test('timers switch cleanly and completing a timed task records the elapsed session', async () => {
  const w = workbench();
  await w.run("toggleTimer('t1')");
  w.run('DB.runningTimer.startedAt -= 120000');
  await w.run("toggleTimer('t2')");
  assert.equal(w.run('DB.timeEntries.length'), 1);
  assert.ok(w.run('DB.timeEntries[0].seconds') >= 120);
  w.run("toggleTask('t2')");
  assert.equal(w.run('DB.runningTimer'), null);
  assert.equal(w.run('DB.timeEntries.length'), 2);
});

test('clearing archives requires confirmation and preserves active work and source deduplication', async () => {
  const w = workbench();
  w.fields['modal-root'] = { value: '', checkValidity: () => true };
  w.run(`DB.inboxArchive = [
    { id: 'removed', title: '敏感归档标题', raw: '敏感归档原文', connectorId: 'ics', externalId: 'cleared-event', deletedAt: '2026-10-22' },
    { id: 'confirmed', title: '已转任务原文', raw: '原文', confirmedTask: 't1' },
    { id: 'ignored', title: '已忽略', connectorId: 'ics', externalId: 'cleared-event' }
  ]`);
  const inbox = w.run('JSON.stringify(DB.inbox)');
  const tasks = w.run('JSON.stringify(allWorkbenchTasks())');
  await w.run('clearInboxArchive()');
  assert.equal(w.run('DB.inboxArchive.length'), 3);
  w.run('requestInboxArchiveClear(); openInboxArchive()');
  await w.run('clearInboxArchive()');
  assert.equal(w.run('DB.inboxArchive.length'), 3);
  w.run('requestInboxArchiveClear()');
  assert.equal(w.run('DB.inboxArchive.length'), 3);
  w.run("DB.inboxArchive.push({id:'new-arrival',title:'确认期间新归档'})");
  await w.run('clearInboxArchive()');
  assert.equal(w.run('DB.inboxArchive.length'), 1);
  assert.equal(w.run('DB.inboxArchive[0].id'), 'new-arrival');
  assert.equal(w.run('JSON.stringify(DB.inbox)'), inbox);
  assert.equal(w.run('JSON.stringify(allWorkbenchTasks())'), tasks);
  assert.equal(w.run('JSON.stringify(DB.integrationReceipts)'),
    JSON.stringify([{ connectorId: 'ics', externalId: 'cleared-event' }]));
  assert.equal(w.run("importIntegrationRecords('ics',[{externalId:'cleared-event',title:'重复',raw:'原文'}])"), 0);
  assert.equal(w.run("importIntegrationRecords('mail',[{externalId:'cleared-event',title:'不同连接器',raw:'邮件'}])"), 1);
  const saved = JSON.parse(String(w.saved[0]));
  assert.equal(JSON.stringify(saved).includes('敏感归档'), false);
  assert.equal(saved.inboxArchive.length, 1);
  assert.equal(saved.integrationReceipts.length, 1);
  await w.run('clearInboxArchive()');
  assert.equal(w.run('DB.inboxArchive.length'), 1);
});

test('weekly and project reports follow edited records instead of fixed prototype content', () => {
  const w = workbench();
  w.run("DB.tasks = {must:[],should:[],could:[]}; DB.taskCalendar={}; state.reportDate='2026-10-21'");
  assert.equal(w.run("getReport('weekly','2026-10-21').facts"), 0);
  w.run("DB.projects=[]; state.report='project'");
  assert.equal(w.run("getReport('project').facts"), 0);
  assert.equal(w.run("reportText(getReport('project')).includes('测试库')"), false);
});

test('risk scores validate before saving and closing a risk updates project counts', async () => {
  const w = workbench();
  w.run("state.recordEditor={kind:'risk',projectId:'p1'}");
  for (const [id, value] of Object.entries({ 'record-title': '测试风险', 'risk-probability': '9',
    'risk-impact': '4', 'record-owner': 'QA', 'record-note': '应对动作', 'record-status': 'closed' })) {
    w.fields[id] = { value, checkValidity: () => true };
  }
  const before = w.run('DB.projectDetails.p1.risks.length');
  await w.run('saveRecordEditor()');
  assert.equal(w.run('DB.projectDetails.p1.risks.length'), before);
  w.fields['risk-probability'].value = '4';
  await w.run('saveRecordEditor()');
  assert.equal(w.run('DB.projectDetails.p1.risks.length'), before + 1);
  assert.equal(w.run('DB.projectDetails.p1.risks.at(-1).score'), 16);
  assert.equal(w.run("projectById('p1').risks"), before);
});

test('document application is idempotent, edits live tasks and never revives deleted tasks', async () => {
  const w = workbench();
  const before = w.run('allWorkbenchTasks().length');
  w.run(`DB.documents.push({id:'doc-qa',title:'验收.docx',content:'完成设备验收',analysis:{
    summary:'验收',mode:'本地规则',tasks:[{id:'draft-qa',title:'完成设备验收',assignee:'QA',
      due:'2030-01-05',priority:'P2',estimateHours:2,evidence:'完成设备验收',selected:true}]}})`);
  await w.run("applyDocumentToProject(documentById('doc-qa'),'p1')");
  await w.run("applyDocumentToProject(documentById('doc-qa'),'p1')");
  assert.equal(w.run('allWorkbenchTasks().length'), before + 1);
  assert.equal(w.run("DB.projectDetails.p1.docs.filter(d=>d.id==='doc-qa').length"), 1);
  const taskId = w.run("documentById('doc-qa').analysis.tasks[0].taskId");
  w.run("documentById('doc-qa').analysis.tasks[0].title='已修改验收任务'");
  w.run("documentById('doc-qa').analysis.tasks[0].due='2030-01-06'");
  await w.run("applyDocumentToProject(documentById('doc-qa'),'p2')");
  assert.equal(w.run(`taskLocation(${JSON.stringify(taskId)}).task.title`), '已修改验收任务');
  assert.equal(w.run(`taskLocation(${JSON.stringify(taskId)}).task.project`), 'p2');
  assert.equal(w.run(`taskLocation(${JSON.stringify(taskId)}).date`), '2030-01-06');
  assert.equal(w.run("DB.projectDetails.p1.docs.some(d=>d.id==='doc-qa')"), false);
  w.run(`{ const found=taskLocation(${JSON.stringify(taskId)}); found.list.splice(found.index,1); }`);
  await w.run("applyDocumentToProject(documentById('doc-qa'),'p2')");
  assert.equal(w.run('allWorkbenchTasks().length'), before);
  assert.equal(w.run("documentById('doc-qa').content"), '完成设备验收');
});
