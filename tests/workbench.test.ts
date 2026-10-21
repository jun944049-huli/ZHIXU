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
    storageGet: () => null,
    storageSet: (key: string, value: string) => { preferences[key] = value; },
    document: { getElementById: (id: string) => fields[id] || null },
    render: () => {}, closeModal: () => {}, showToast: () => {},
    scrollChatToBottom: () => {},
    persistWorkbench: async () => { saved.push(runInContext('JSON.stringify(DB)', context)); }
  });
  for (const file of ['data.js', 'shared.js', 'views-chat.js', 'views-project.js', 'operations.js']) {
    runInContext(readFileSync(resolve('prototype', file), 'utf8'), context, { filename: file });
  }
  return {
    run: (code: string) => runInContext(code, context),
    fields, saved, preferences
  };
}

test('project removal preserves linked tasks across all dates and archives notes', async () => {
  const w = workbench();
  const before = w.run('allWorkbenchTasks().length');
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
