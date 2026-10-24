import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

function workbench() {
  const fields: Record<string, { value: string; checked?: boolean; checkValidity(): boolean }> = {};
  const saved: unknown[] = [];
  const preferences: Record<string, string> = {};
  const context = createContext({
    crypto: webcrypto, console, setTimeout, clearTimeout, Blob,
    workbenchSnapshot: () => ({ db: {}, preferences: {} }),
    window: {},
    storageGet: () => null,
    storageSet: (key: string, value: string) => { preferences[key] = value; },
    document: { getElementById: (id: string) => fields[id] || null, querySelector: () => null,
      addEventListener: () => {} },
    render: () => {}, closeModal: () => {}, showToast: () => {},
    scrollChatToBottom: () => {},
    persistWorkbench: async () => { saved.push(runInContext('JSON.stringify(DB)', context)); }
  });
  for (const file of ['data.js', 'shared.js', 'chat-format.js', 'views-chat.js', 'views-project.js', 'views-output.js',
    'operations.js', 'work-sync.js', 'integrations.js', 'features.js', 'analytics.js', 'documents.js', 'document-workflow.js', 'workspace.js', 'plugins.js']) {
    runInContext(readFileSync(resolve('prototype', file), 'utf8'), context, { filename: file });
  }
  runInContext('initializeIntegrations(); initializeFeatures();', context);
  return {
    run: (code: string) => runInContext(code, context),
    fields, saved, preferences
  };
}

test('overdue migration preserves independent projects, completed tasks and task identity across reloads', () => {
  const w = workbench();
  w.run(`DB.tasks={must:[],should:[],could:[]}; DB.taskCalendar={};
    addConfirmedTask({id:'same-a',title:'相同标题',project:'p1',done:true,due:'2030-01-01'},DB.meta.today,'should');
    DB.overdue=[{id:'old-a',title:'相同标题',project:'p1',days:2},
      {id:'old-b',title:'相同标题',project:'p2',days:3}];
    migrateOverdueTasks();`);
  assert.equal(w.run('allWorkbenchTasks().length'), 2);
  assert.equal(w.run('overdueTasks().length'), 1);
  assert.equal(w.run('overdueTasks()[0].id'), 'old-b');
  w.run('initializeFeatures(); initializeFeatures()');
  assert.equal(w.run('allWorkbenchTasks().length'), 2);
  assert.equal(w.run('DB.overdue.length'), 0);
});

function seedWorkUpdate(w: ReturnType<typeof workbench>) {
  w.run(`DB.tasks={must:[],should:[],could:[]}; DB.taskCalendar={};
    DB.projects=DB.projects.filter(p=>['p1','p2'].includes(p.id));
    projectById('p1').name='青禾小学';
    DB.projectDetails.p1.milestones=[
      {id:'repair-ms',name:'维修完成',date:'2026-10-20',status:'open',taskIds:['repair-a','repair-b']},
      {id:'deploy-ms',name:'设备部署',date:'2026-10-30',status:'open',taskIds:['deploy']},
      {id:'accept-ms',name:'联调验收',date:'2026-11-01',status:'open',taskIds:['accept']}];
    for(const [id,title,project] of [
      ['repair-a','维修灯具','p1'],['repair-b','维修门窗','p1'],
      ['deploy','设备部署','p1'],['accept','联调验收','p1'],['other','维修灯具','p2']]) {
      addConfirmedTask({id,title,project,done:false,estimate:'1h',priority:'P2',
        due:addDaysISO(DB.meta.today,-1)},id==='repair-a'?addDaysISO(DB.meta.today,-3):DB.meta.today,'should');
    }
    DB.documents=[{id:'source-doc',projectId:'p1',analysis:{tasks:[{taskId:'repair-a'},{taskId:'deploy'}]}}];
    DB.waiting=[{id:'linked-wait',title:'等待维修灯具',taskId:'repair-a',project:'p1'}];
    DB.runningTimer={taskId:'repair-a',project:'p1',startedAt:Date.now()-10000,date:DB.meta.today};
    window.repairUpdate={type:'work_update',projectId:'p1',tasks:[
      {taskId:'repair-a',status:'done'},{taskId:'repair-b',status:'done'}],milestones:[]};`);
}

test('completion updates linked milestones, progress, overdue, documents, waiting and completion-day reports', () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run("window.card=modelWorkUpdateCard([window.repairUpdate],'青禾小学维修全部完成'); applyWorkUpdateCard(window.card)");
  assert.equal(w.run("taskLocation('repair-a').task.status"), '已完成');
  assert.equal(w.run("taskLocation('other').task.done"), false);
  assert.equal(w.run("DB.projectDetails.p1.milestones[0].status"), 'done');
  assert.equal(w.run("DB.projectDetails.p1.milestones[1].status"), 'risk');
  assert.equal(w.run("projectById('p1').progress"), 50);
  assert.equal(w.run("projectById('p1').next"), '设备部署');
  assert.equal(w.run("projectById('p1').open"), 2);
  assert.equal(w.run("overdueTasks().some(t=>t.id==='repair-a')"), false);
  assert.equal(w.run("DB.runningTimer"), null);
  assert.equal(w.run("DB.timeEntries.length"), 1);
  assert.equal(w.run("DB.documents[0].analysis.tasks[0].done"), true);
  assert.equal(w.run("DB.waiting[0].status"), 'done');
  assert.match(w.run("JSON.stringify(getReport('daily',DB.meta.today))"), /维修灯具/);
  assert.equal(w.run("allWorkbenchTasks().length"), 5);
  assert.equal(w.run("projectNotesFor('p1')[0].source"), '对话状态同步');
});

test('manual reopening and completing tasks reconcile the same project and keep incomplete milestones below 100%', () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run("applyWorkUpdateCard(modelWorkUpdateCard([window.repairUpdate],'维修完成'))");
  w.run("toggleTask('repair-a')");
  assert.equal(w.run("DB.projectDetails.p1.milestones[0].status"), 'risk');
  assert.equal(w.run("projectById('p1').progress"), 25);
  assert.equal(w.run("DB.documents[0].analysis.tasks[0].done"), false);
  w.run("toggleTask('repair-a'); toggleTask('deploy'); toggleTask('accept')");
  assert.equal(w.run("projectById('p1').progress"), 100);
  assert.equal(w.run("projectById('p1').status"), '已完成');
  w.run("DB.projectDetails.p1.milestones.push({id:'untracked',name:'最终确认',status:'open'}); reconcileProjectWork(['p1'])");
  assert.equal(w.run("projectById('p1').progress"), 99);
  assert.equal(w.run("projectById('p1').next"), '最终确认');
});

test('generated empty milestones do not block project completion and new milestones have no implicit links', () => {
  const w = workbench(); seedWorkUpdate(w);
  assert.equal(w.run("milestoneTaskIds('p1',{}).length"), 0);
  w.run(`DB.projectDetails.p1.milestones=[{id:'milestone-p1',name:'未安排',date:'—',status:'open'}];
    allWorkbenchTasks().filter(task=>task.project==='p1').forEach(task=>setWorkTaskStatus(task,'done'));
    reconcileProjectWork(['p1']);`);
  assert.equal(w.run("projectById('p1').progress"), 100);
  assert.equal(w.run("projectMilestones('p1').length"), 0);
  assert.equal(w.run("DB.projectDetails.p1.milestones.length"), 1);
  w.run("DB.projectDetails.p1.milestones.push({id:'user-node',name:'待安排',date:'—',status:'open'}); reconcileProjectWork(['p1'])");
  assert.equal(w.run("projectMilestones('p1').length"), 1);
  assert.equal(w.run("projectById('p1').progress"), 99);
});

test('editing an already completed legacy task retains its original completion day', () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run(`Object.assign(taskLocation('repair-a').task,{done:true,completedAt:'2026-10-19T08:00:00.000Z'});
    setWorkTaskStatus(taskLocation('repair-a').task,'done');`);
  assert.equal(w.run("taskLocation('repair-a').task.completedDate"), '2026-10-19');
  assert.doesNotMatch(w.run("JSON.stringify(getReport('daily',DB.meta.today))"), /维修灯具（青禾小学/);
});

test('stale, cross-project and premature milestone updates are rejected before any mutation', () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run("window.card=modelWorkUpdateCard([window.repairUpdate],'维修完成'); taskLocation('repair-b').task.title='已编辑标题'");
  assert.throws(() => w.run('applyWorkUpdateCard(window.card)'), /已变更/);
  assert.equal(w.run("taskLocation('repair-a').task.done"), false);
  w.run("window.bad={type:'work_update',projectId:'p1',tasks:[{taskId:'other',status:'done'}],milestones:[]}");
  assert.throws(() => w.run("applyWorkUpdateCard(modelWorkUpdateCard([window.bad],'完成'))"), /归属/);
  w.run("window.bad={type:'work_update',projectId:'p1',tasks:[{taskId:'repair-a',status:'done'}],milestones:[{milestoneId:'repair-ms',status:'done'}]}");
  assert.throws(() => w.run("applyWorkUpdateCard(modelWorkUpdateCard([window.bad],'维修完成'))"), /仍有关联任务未完成/);
  w.run("window.bad.milestones[0].taskIds=['repair-a']");
  assert.throws(() => w.run("applyWorkUpdateCard(modelWorkUpdateCard([window.bad],'维修完成'))"), /仍有关联任务未完成/);
  assert.equal(w.run("taskLocation('repair-a').task.done"), false);
});

test('explicit status statements sync once; questions stay pending and save failures restore the whole update', async () => {
  const w = workbench(); seedWorkUpdate(w);
  w.fields['chat-input'] = { value: '青禾小学维修部分已经全部完成了', checkValidity: () => true };
  w.run(`DB.settings.aiProvider='custom'; DB.settings.customProvider={
    name:'验收模型',baseUrl:'http://127.0.0.1',apiKey:'isolated',model:'semantic-model'};
    window.xiaoyuDesktop={chat:async()=>({reply:'维修完成',model:'semantic-model',warnings:[],actions:[window.repairUpdate]})};`);
  await w.run('sendChat()');
  assert.equal(w.run("taskLocation('repair-a').task.done"), true);
  assert.equal(w.run("state.chatMessages.at(-1).actionCard.status"), 'done');
  await w.run('applyChatAction()');
  assert.equal(w.run("projectNotesFor('p1').filter(n=>n.source==='对话状态同步').length"), 1);
  w.fields['chat-input'].value = '部署完成了';
  w.run("window.repairUpdate={type:'work_update',projectId:'p1',requiresConfirmation:true,tasks:[{taskId:'deploy',status:'done'}],milestones:[]}");
  await w.run('sendChat()');
  assert.equal(w.run("taskLocation('deploy').task.done"), false);
  assert.equal(w.run("state.chatMessages.at(-1).actionCard.status"), 'pending');
  w.run("cancelChat()");
  w.fields['chat-input'].value = '如果设备部署完成，是否可以验收？';
  w.run("window.repairUpdate={type:'work_update',projectId:'p1',tasks:[{taskId:'deploy',status:'done'}],milestones:[]}");
  await w.run('sendChat()');
  assert.equal(w.run("taskLocation('deploy').task.done"), false);
  assert.equal(w.run("state.chatMessages.at(-1).actionCard.status"), 'pending');
  w.run("persistWorkbench=async()=>{throw new Error('磁盘已满')}");
  await w.run('applyChatAction()');
  assert.equal(w.run("taskLocation('deploy').task.done"), false);
  assert.equal(w.run("projectById('p1').progress"), 50);
  assert.equal(w.run("state.chatMessages.at(-1).actionCard.status"), 'pending');
  assert.match(w.run('state.chatMessages.at(-1).text'), /磁盘已满/);
});

test('saving overdue edits, rescheduling and completing one task update only its reminder', async () => {
  const w = workbench();
  w.run(`DB.tasks={must:[],should:[],could:[]}; DB.taskCalendar={};
    for (const id of ['a','b']) addConfirmedTask({id,title:'同名任务',project:id==='a'?'p1':'p2',
      due:addDaysISO(DB.meta.today,-2),overdue:true,priority:'P2',estimate:'1h'},DB.meta.today,'should');
    state.editTaskId='a';`);
  const today = w.run('DB.meta.today');
  const yesterday = w.run('addDaysISO(DB.meta.today,-2)');
  for (const [key, value] of Object.entries({
    title: '更新后的清单', project: 'p1', date: today, due: yesterday, hours: '1',
    priority: 'P2', status: 'doing', assignee: 'QA', note: '补充清单'
  })) w.fields['task-' + key] = { value, checkValidity: () => true };
  await w.run('saveTaskEditor()');
  assert.equal(w.run('overdueTasks().length'), 2);
  assert.equal(w.run("overdueTasks().find(t=>t.id==='a').title"), '更新后的清单');
  w.fields['task-due'].value = w.run('addDaysISO(DB.meta.today,2)');
  await w.run('saveTaskEditor()');
  assert.equal(w.run('overdueTasks().length'), 1);
  assert.equal(w.run("taskLocation('a').task.overdue"), false);
  await w.run("handleFeatureAction('overdue-plan',{dataset:{id:'b'}})");
  assert.equal(w.run('overdueTasks().length'), 0);
  assert.equal(w.run('allWorkbenchTasks().length'), 2);
  w.run("taskLocation('a').task.due=addDaysISO(DB.meta.today,-1); taskLocation('b').task.due=addDaysISO(DB.meta.today,-1)");
  w.run("toggleTask('a')");
  assert.equal(w.run('overdueTasks().length'), 1);
  assert.equal(w.run('overdueTasks()[0].id'), 'b');
  w.run("toggleTask('a')");
  assert.equal(w.run('overdueTasks().length'), 2);
  w.fields['task-due'].value = w.run("taskLocation('a').task.due");
  w.fields['task-date'].value = w.run('addDaysISO(DB.meta.today,3)');
  await w.run('saveTaskEditor()');
  assert.equal(w.run('overdueTasks().length'), 1);
  assert.equal(w.run("taskDeadlineDate(taskLocation('a').task)"), w.fields['task-date'].value);
  w.run("initializeFeatures()");
  assert.equal(w.run('overdueTasks().length'), 1);
});

test('relative deadlines stay anchored across day rollover and invalid task dates cannot move records', async () => {
  const w = workbench();
  w.run(`DB.tasks={must:[],should:[],could:[]}; DB.taskCalendar={};
    addConfirmedTask({id:'relative',title:'相对日期',due:'昨天 18:00',overdue:true},DB.meta.today,'should');
    migrateOverdueTasks();`);
  const deadline = w.run("taskDeadlineDate(taskLocation('relative').task)");
  w.run('DB.meta.today=addDaysISO(DB.meta.today,1); migrateOverdueTasks()');
  assert.equal(w.run("taskDeadlineDate(taskLocation('relative').task)"), deadline);
  assert.equal(w.run('overdueTasks()[0].days'), 2);
  w.run("state.editTaskId='relative'");
  for (const [key, value] of Object.entries({ title:'无效日期',date:'2026-02-30',hours:'1' }))
    w.fields['task-' + key] = { value, checkValidity: () => true };
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskLocation('relative').task.title"), '相对日期');
});

test('task remarks append timestamped rows, retain originals and survive snapshot reload without duplication', async () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run("state.editTaskId='repair-a'; taskLocation('repair-a').task.note='原始附件说明'");
  for (const [key, value] of Object.entries({
    title: '维修灯具', project: 'p1', date: w.run('DB.meta.today'), due: '2026-11-01', hours: '1',
    priority: 'P2', status: 'doing', progress: '40', assignee: 'QA', note: '已检查线路，等待更换配件'
  })) w.fields['task-' + key] = { value, checkValidity: () => true };
  await w.run('saveTaskEditor()');
  const first = w.run("JSON.stringify(taskNotesFor(taskLocation('repair-a').task))");
  w.fields['task-note'].value = '配件已更换，验收通过';
  w.fields['task-status'].value = 'done';
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskLocation('repair-a').task.note"), '原始附件说明');
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task).length"), 3);
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task)[0].progress"), 100);
  assert.match(w.run("taskNotesFor(taskLocation('repair-a').task)[0].text"), /验收通过/);
  assert.equal(w.run("JSON.stringify(taskNotesFor(taskLocation('repair-a').task).slice(1))"), first);
  assert.match(w.run("noteTimestamp(taskNotesFor(taskLocation('repair-a').task)[0])"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(w.run("noteTimestamp(taskNotesFor(taskLocation('repair-a').task)[2])"), '时间未记录');
  assert.equal(w.run("projectNotesFor('p1').filter(note=>note.taskId==='repair-a').length"), 2);
  const saved = w.saved.at(-1);
  assert.equal(typeof saved, 'string');
  w.run(`Object.assign(DB,JSON.parse(${JSON.stringify(saved)})); initializeFeatures()`);
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task).length"), 3);
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task).length"), 3);
  w.fields['task-note'].value = '';
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task).length"), 3);
});

test('chat retains project-language task notes and raw text, and failed persistence rolls back both timelines', async () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run(`window.repairUpdate.note='维修工程已完成，设备部署待推进';
    window.repairUpdate.tasks[0].note='灯具维修已完成，现场检查通过';
    window.repairUpdate.tasks[1].note='门窗维修已完成';
    state.chatMessages=[{text:'确认同步',actionCard:modelWorkUpdateCard([window.repairUpdate],'灯都弄好啦，检查也过了')}];`);
  await w.run('applyWorkUpdateMessage(state.chatMessages[0])');
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task)[0].text"), '灯具维修已完成，现场检查通过');
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task)[0].raw"), '灯都弄好啦，检查也过了');
  assert.equal(w.run("projectNotesFor('p1')[0].text"), '维修工程已完成，设备部署待推进');
  assert.match(w.run("projectNotesFor('p1')[0].createdAt"), /T/);
  assert.equal(w.run("taskNotesFor(taskLocation('other').task).length"), 0);
  const history = w.run("JSON.stringify(DB.projectNotes)");
  w.run(`state.chatMessages.push({text:'确认同步',actionCard:modelWorkUpdateCard([{
    type:'work_update',projectId:'p1',tasks:[{taskId:'deploy',status:'doing',note:'部署已启动'}],milestones:[]
  }],'部署开始了')}); persistWorkbench=async()=>{throw Error('存储失败')}`);
  await w.run('applyWorkUpdateMessage(state.chatMessages.at(-1))');
  assert.equal(w.run("taskNotesFor(taskLocation('deploy').task).length"), 0);
  assert.equal(w.run("JSON.stringify(DB.projectNotes)"), history);
  assert.equal(w.run("taskLocation('deploy').task.status"), undefined);
});

test('note-only updates preserve partial completion and project progress, and render every record safely', async () => {
  const w = workbench(); seedWorkUpdate(w);
  const progress = w.run("projectById('p1').progress");
  w.run(`Object.assign(taskLocation('repair-a').task,{status:'进行中',progress:50,
    workItems:[{done:true,progress:100},{done:false,progress:0}]});
    window.noteUpdate={type:'work_update',projectId:'p1',note:'灯具型号已与校方确认',
      tasks:[{taskId:'repair-a',status:'doing',progress:50,note:'已确认灯具型号，等待配件'}],milestones:[]};
    applyWorkUpdateCard(modelWorkUpdateCard([window.noteUpdate],'配件还没来，型号已经确认'));`);
  assert.equal(w.run("taskLocation('repair-a').task.workItems[0].done"), true);
  assert.equal(w.run("taskLocation('repair-a').task.workItems[1].done"), false);
  assert.equal(w.run("projectById('p1').progress"), progress);
  w.run("state.editTaskId='repair-a'");
  for (const [key, value] of Object.entries({
    title:'维修灯具',project:'p1',date:w.run("taskLocation('repair-a').date"),
    due:w.run("taskDeadlineDate(taskLocation('repair-a').task)"),hours:'1',priority:'P2',
    status:'doing',progress:'50',note:'采购已回复，预计明日到货'
  })) w.fields['task-' + key] = { value, checkValidity: () => true };
  await w.run('saveTaskEditor()');
  assert.equal(w.run("projectById('p1').progress"), progress);
  assert.equal(w.run("taskLocation('repair-a').task.workItems[0].done"), true);
  w.run(`window.noteUpdate={type:'work_update',projectId:'p1',note:'<script>项目纪要</script>',tasks:[],milestones:[]};
    applyWorkUpdateCard(modelWorkUpdateCard([window.noteUpdate],'帮我记一下项目纪要'));
    state.projectId='p1'; state.projectTab='notes';`);
  assert.equal(w.run("projectById('p1').progress"), progress);
  const html = w.run('renderProject()');
  assert.match(html, /&lt;script&gt;项目纪要&lt;\/script&gt;/);
  assert.match(html, /已确认灯具型号/);
  assert.match(html, /灯具型号已与校方确认/);
  assert.doesNotMatch(html, /<script>/);
});

test('deadline picker accepts exact dates or clearing, preserves legacy wording and rejects invalid dates', async () => {
  const w = workbench(); seedWorkUpdate(w);
  w.run("state.editTaskId='repair-a'; taskLocation('repair-a').task.due='待校方确认'; delete taskLocation('repair-a').task.deadlineDate");
  for (const [key, value] of Object.entries({
    title:'维修灯具',project:'p1',date:w.run('DB.meta.today'),due:'2026-02-30',hours:'1',priority:'P2',note:'尚未写入'
  })) w.fields['task-' + key] = { value, checkValidity: () => true };
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskLocation('repair-a').task.due"), '待校方确认');
  assert.equal(w.run("taskNotesFor(taskLocation('repair-a').task).length"), 0);
  w.fields['task-due'].value = '2026-11-05';
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskLocation('repair-a').task.dueDescription"), '待校方确认');
  assert.equal(w.run("taskDeadlineDate(taskLocation('repair-a').task)"), '2026-11-05');
  w.fields['task-due'].value = '';
  w.fields['task-note'].value = '';
  await w.run('saveTaskEditor()');
  assert.equal(w.run("taskDeadlineDate(taskLocation('repair-a').task)"), null);
  assert.equal(w.run("isTaskOverdue(taskLocation('repair-a').task)"), false);
  w.run('initializeFeatures()');
  assert.equal(w.run("taskDeadlineDate(taskLocation('repair-a').task)"), null);
});

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

test('message model identity survives switching during a request and confirming older proposals', async () => {
  const w = workbench();
  w.fields['chat-input'] = { value: '请求模型甲', checkValidity: () => true };
  w.run(`DB.settings.aiProvider='custom'; DB.settings.customProvider={
    name:'供应商',baseUrl:'http://127.0.0.1',apiKey:'isolated',model:'model-a'};
    window.xiaoyuDesktop={chat:()=>new Promise(resolve=>{window.finishReply=resolve})};`);
  const pending = w.run('sendChat()');
  w.run(`DB.settings.customProvider.model='model-b'; state.chatModel=chatModelLabel();
    window.finishReply({reply:'甲的回复',model:'model-a',warnings:[],actions:[
      {type:'progress',projectId:'p1',progress:50}]});`);
  await pending;
  assert.equal(w.run('state.chatMessages.at(-1).model'), 'model-a');
  assert.match(w.run('renderChatMessage(state.chatMessages.at(-1))'), /title="model-a">model-a<\/span>/);
  w.run("window.xiaoyuDesktop.chat=async()=>({reply:'乙的回复',model:' ',actions:[],warnings:[]})");
  w.fields['chat-input'].value = '请求模型乙';
  await w.run('sendChat()');
  assert.equal(w.run('state.chatMessages.at(-1).model'), 'model-b');
  assert.match(w.run('renderChatMessage(state.chatMessages.at(-1))'), /title="model-b">model-b<\/span>/);
  const cardId = w.run('state.chatMessages.find(m=>m.actionCard).actionCard.id');
  await w.run(`applyChatAction('', ${JSON.stringify(cardId)})`);
  assert.equal(w.run('state.chatMessages.at(-1).model'), 'model-a');
  w.run(`state.chatMessages.push({role:'assistant',model:'model-a',actionCard:modelChatCard({
    type:'progress',projectId:'p1',progress:70},'待取消')}); cancelChat();`);
  assert.equal(w.run('state.chatMessages.at(-1).model'), 'model-a');
  assert.match(w.run("renderChatMessage({role:'assistant',text:'旧记录',time:'过去'})"), /来源未记录/);
  assert.equal(w.run("renderChatMessage({role:'assistant',text:'旧记录',time:'过去'}).includes('model-b')"), false);
  assert.match(w.run("renderChatMessage({role:'assistant',model:'<model>',text:'正文',time:'现在'})"), /&lt;model&gt;/);
  assert.equal(w.run("renderChat().includes('chat-safety')"), false);
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
  w.fields['project-note'] = { value: '方案已提交，等待校方反馈', checkValidity: () => true };
  await w.run('saveProject()');
  assert.equal(w.run('DB.projects.length'), 7);
  assert.equal(w.run('projectById(state.projectId).progress'), 65);
  assert.equal(w.run('projectById(state.projectId).name'), '已修改项目');
  assert.match(w.run('projectNotesFor(state.projectId)[0].text'), /65%.*\n方案已提交/);
  w.fields['project-note'].value = '校方反馈已收到';
  await w.run('saveProject()');
  assert.equal(w.run('projectNotesFor(state.projectId).length'), 2);
  assert.match(w.run('projectNotesFor(state.projectId)[1].text'), /方案已提交/);
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
  assert.equal(w.run("integrationStatus('manual').on"), false);
  assert.equal(w.run("integrationStatus('github').label"), '尚未接入');
  assert.doesNotMatch(w.run('renderData()'), /data-id="manual"/);
  w.run("openCapture=()=>{throw Error('wrong route')}; openIntegration('manual')");
  assert.equal(w.run('state.dataTab'), 'plugins');
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
    title: task.title, project: task.project, date: w.run('DB.meta.today'), due: w.run("taskDeadlineDate(taskLocation('t1').task) || ''"),
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

async function seedDocumentWorkflow(w: ReturnType<typeof workbench>) {
  w.run(`DB.tasks={must:[],should:[],could:[]}; DB.taskCalendar={}; DB.projectDetails.p1.milestones=[];
    DB.documents=[{id:'workflow',title:'执行清单.docx',content:'完成门窗维修\\n完成灯具维修\\n完成设备部署',
      projectId:null,analysis:{summary:'维修与部署',mode:'测试模型',model:'workflow-model',tasks:[
        {id:'a',title:'完成门窗维修',details:'核对门锁',evidence:'完成门窗维修',due:'',assignee:'',priority:'P2',estimateHours:0,selected:true},
        {id:'b',title:'完成灯具维修',details:'核对线路',evidence:'完成灯具维修',due:'',assignee:'',priority:'P2',estimateHours:0,selected:true},
        {id:'c',title:'完成设备部署',details:'安装设备',evidence:'完成设备部署',due:'',assignee:'',priority:'P2',estimateHours:0,selected:true}
      ]}}];`);
  await w.run("applyDocumentToProject(documentById('workflow'),'p1')");
  w.run(`window.ids=documentById('workflow').analysis.tasks.map(task=>task.taskId);
    setWorkTaskStatus(taskLocation(window.ids[0]).task,'done');
    DB.projectDetails.p1.milestones=[{id:'repair',name:'维修',taskIds:window.ids.slice(0,2),status:'open'}];
    DB.waiting=[{id:'wait',taskId:window.ids[1],project:'p1'}];
    DB.timeEntries=[{id:'time',taskId:window.ids[1],seconds:10}];
    reconcileProjectWork(['p1']);`);
}

test('document task merge keeps original completion and progress and completes every linked part together', async () => {
  const w = workbench(); await seedDocumentWorkflow(w);
  w.run(`appendTaskNote(taskLocation(window.ids[0]).task,'门窗检查通过');
    appendTaskNote(taskLocation(window.ids[1]).task,'灯具等待配件');`);
  const before = w.run("projectById('p1').progress");
  w.run(`{
    const doc=documentById('workflow');
    const combined=combineDocumentTasks(doc.analysis.tasks.slice(0,2),'完成维修交付');
    doc.analysis.tasks=[combined,doc.analysis.tasks[2]];
  }`);
  await w.run("applyDocumentToProject(documentById('workflow'),'p1')");
  assert.equal(w.run('allWorkbenchTasks().length'), 2);
  assert.equal(w.run("projectById('p1').progress"), before);
  assert.equal(w.run("taskLocation(window.ids[0]).task.workItems[0].done"), true);
  assert.equal(w.run("taskLocation(window.ids[0]).task.workItems[1].done"), false);
  assert.match(w.run("JSON.stringify(taskNotesFor(taskLocation(window.ids[0]).task))"), /门窗检查通过/);
  assert.match(w.run("JSON.stringify(taskNotesFor(taskLocation(window.ids[0]).task))"), /灯具等待配件/);
  assert.match(w.run("taskLocation(window.ids[0]).task.details"), /核对门锁[\s\S]*核对线路/);
  assert.equal(w.run("DB.waiting[0].taskId===window.ids[0] && DB.timeEntries[0].taskId===window.ids[0]"), true);
  assert.equal(w.run('DB.projectDetails.p1.milestones[0].taskIds.length'), 1);
  w.run('toggleTask(window.ids[0])');
  assert.equal(w.run('taskLocation(window.ids[0]).task.workItems.every(task=>task.done)'), true);
  assert.equal(w.run("DB.projectDetails.p1.milestones[0].status"), 'done');
  assert.equal(w.run("DB.waiting[0].status"), 'done');
  assert.equal(w.run("documentById('workflow').analysis.tasks[0].done"), true);
  assert.equal(w.run("projectById('p1').progress"), 67);
  w.run('toggleTask(window.ids[0])');
  assert.equal(w.run('taskLocation(window.ids[0]).task.workItems.every(task=>!task.done)'), true);
});

test('merge rejects unrelated milestones, owners, dates and foreign document records without mutations', async () => {
  const w = workbench(); await seedDocumentWorkflow(w);
  assert.throws(() => w.run("combineDocumentTasks(documentById('workflow').analysis.tasks,'全部')"), /里程碑/);
  w.run("taskLocation(window.ids[0]).task.assignee='甲'; taskLocation(window.ids[1]).task.assignee='乙'");
  assert.throws(() => w.run("validateDocumentMerge(window.ids.slice(0,2))"), /负责人/);
  w.run("taskLocation(window.ids[1]).task.assignee='甲'; taskLocation(window.ids[0]).task.due='2030-01-01'; taskLocation(window.ids[1]).task.due='2030-01-02'");
  assert.throws(() => w.run("validateDocumentMerge(window.ids.slice(0,2))"), /截止日期/);
  w.run(`taskLocation(window.ids[1]).task.due='2030-01-01';
    documentById('workflow').analysis.tasks=[combineDocumentTasks(documentById('workflow').analysis.tasks.slice(0,2),'维修')];
    taskLocation(window.ids[1]).task.sourceDocumentId='foreign'`);
  const snapshot = w.run('JSON.stringify(DB)');
  await assert.rejects(w.run("applyDocumentToProject(documentById('workflow'),'p1')"), /此附件/);
  assert.equal(w.run('JSON.stringify(DB)'), snapshot);
});

test('reanalysis groups existing tasks by explicit IDs, keeps other work and rejects duplicate/unknown IDs', async () => {
  const w = workbench(); await seedDocumentWorkflow(w);
  w.run(`window.result={summary:'精简',tasks:[{title:'维修交付',details:'完成维修验收',sourceTaskIds:window.ids.slice(0,2),
    evidence:'完成门窗维修',assignee:'',due:'',priority:'P2',estimateHours:0}]};
    window.prepared=prepareDocumentAnalysis(window.result,documentById('workflow').analysis.tasks);`);
  assert.equal(w.run('window.prepared.tasks.length'), 2);
  assert.equal(w.run('window.prepared.tasks[0].mergeTaskIds.length'), 1);
  assert.match(w.run('window.prepared.tasks[0].details'), /核对线路/);
  w.run("window.result.tasks[0].sourceTaskIds=['unknown']");
  assert.throws(() => w.run("prepareDocumentAnalysis(window.result,documentById('workflow').analysis.tasks)"), /不属于/);
  w.run('window.result.tasks[0].sourceTaskIds=window.ids.slice(0,2);window.result.tasks.push(window.result.tasks[0])');
  assert.throws(() => w.run("prepareDocumentAnalysis(window.result,documentById('workflow').analysis.tasks)"), /重复分组/);
});

function documentEditorFields(w: ReturnType<typeof workbench>, project = 'p1') {
  w.run("state.documentId='workflow'; state.documentDraft=JSON.parse(JSON.stringify(documentById('workflow').analysis)); state.view='project'");
  const tasks = JSON.parse(w.run('JSON.stringify(state.documentDraft.tasks)'));
  for (const [key, value] of Object.entries({ project, 'project-name': '待确认新项目', summary: '简短分析摘要',
    'edit-instructions': '按交付物合并', engine: 'local' })) {
    w.fields['document-' + key] = { value, checkValidity: () => true };
  }
  tasks.forEach((task: any, index: number) => {
    for (const [key, value] of Object.entries({ title: task.title, details: task.details || '', owner: task.assignee,
      due: task.due, priority: task.priority, hours: String(task.estimateHours), selected: '' })) {
      w.fields[`draft-${key}-${index}`] = { value: String(value), checked: true, checkValidity: () => true };
    }
  });
}

test('saving returns to chat with a single durable summary, detail route and editable task details', async () => {
  const w = workbench(); await seedDocumentWorkflow(w); documentEditorFields(w);
  await w.run('saveDocumentEditor()');
  assert.equal(w.run('state.view'), 'chat');
  assert.match(w.run("state.chatMessages.at(-1).text"), /简短分析摘要/);
  assert.match(w.run("renderChatMessage(state.chatMessages.at(-1))"), /document-chat-details/);
  assert.equal(w.run('state.chatMessages.at(-1).model'), 'workflow-model');
  assert.equal(JSON.parse(w.preferences['jw-chat-history']).at(-1).documentId, 'workflow');
  documentEditorFields(w);
  w.fields['draft-details-0'].value = '更新维修详细清单';
  await w.run('saveDocumentEditor()');
  assert.equal(w.run("state.chatMessages.filter(message=>message.documentId==='workflow').length"), 1);
  assert.equal(w.run("taskLocation(window.ids[0]).task.details"), '更新维修详细清单');
  w.fields['modal-root'] = { value: '', checkValidity: () => true };
  w.run("openDocumentChatDetails('workflow')");
  assert.equal(w.run('state.view'), 'project');
  assert.equal(w.run('state.projectId'), 'p1');
});

test('failed saves roll back document/task/project/chat changes and new project drafts wait for confirmation', async () => {
  const w = workbench(); await seedDocumentWorkflow(w); documentEditorFields(w);
  const before = w.run('JSON.stringify(DB)');
  w.run("persistWorkbench=async()=>{throw new Error('磁盘写入失败')}");
  await assert.rejects(w.run('saveDocumentEditor()'), /磁盘写入失败/);
  assert.equal(w.run('JSON.stringify(DB)'), before);
  assert.equal(w.run('state.view'), 'project');
  assert.equal(w.run("state.chatMessages.some(message=>message.documentId==='workflow')"), false);
  const fresh = workbench(); await seedDocumentWorkflow(fresh);
  fresh.run("documentById('workflow').projectId=null");
  documentEditorFields(fresh, 'new');
  const count = fresh.run('DB.projects.length');
  await fresh.run('saveDocumentEditor()');
  assert.equal(fresh.run('DB.projects.length'), count);
  assert.match(fresh.run('state.chatMessages.at(-1).text'), /待确认/);
});
