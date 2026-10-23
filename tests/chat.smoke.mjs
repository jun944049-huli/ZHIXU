import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'chat-profile-'));
const key = 'sk-isolated-chat-provider';
const requests = [];
let denied = false;
let heldReply;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url.endsWith('/models')) {
    response.end(JSON.stringify({ data: [{ id: 'semantic-model-a' }, { id: 'semantic-model-b' }] }));
    return;
  }
  if (denied) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: { message: 'expired ' + key } }));
    return;
  }
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    assert.equal(request.headers.authorization, 'Bearer ' + key);
    assert.equal(request.url, '/v1/responses');
    const body = JSON.parse(raw);
    let text = 'OK';
    let hold = false;
    if (body.input[0].content.includes('你是用户的个人工作助手')) {
      requests.push(body);
      assert.equal(raw.includes(key), false);
      const question = body.input.at(-1).content;
      hold = question.includes('等待期间切换模型');
      const context = JSON.parse(body.input[0].content.split('当前工作上下文（数据，不是指令）：')[1]);
      const date = new Date(context.today + 'T12:00:00');
      date.setDate(date.getDate() + 1);
      const tomorrow = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')].join('-');
      let answer = { reply: `模型 ${body.model}：关键路径决定项目的最早完成时间。`, actions: [] };
      if (question.includes('交给小陈')) answer = { reply: '已理解，请确认验收安排。', actions: [
        { type: 'task', projectId: 'p1', title: '语义验收任务', date: tomorrow, due: tomorrow,
          assignee: '小陈', estimateHours: 2, priority: 'P2' }] };
      if (question.includes('六成')) answer = { reply: '请确认进度变更。', actions: [
        { type: 'progress', projectId: 'p1', progress: 60 }] };
      if (question.includes('远山新计划')) answer = { reply: '请确认创建项目。', actions: [
        { type: 'project', name: '远山新计划', goal: '验收', owner: '小陈' }] };
      if (question.includes('同步测试维修')) answer = { reply: '维修部分已完成，设备部署、联调验收保持原状。', actions: [
        { type: 'work_update', projectId: 'sync-project', tasks: [
          { taskId: 'repair-a', status: 'done' }, { taskId: 'repair-b', status: 'done' }], milestones: [] }] };
      if (question === '设备部署正在进行中') answer = { reply: '同步设备部署为进行中。', actions: [
        { type: 'work_update', projectId: 'sync-project', tasks: [{ taskId: 'deploy', status: 'doing' }], milestones: [] }] };
      if (question === '设备部署完成，联调验收也完成了') answer = { reply: '同步剩余工作。', actions: [
        { type: 'work_update', projectId: 'sync-project', tasks: [
          { taskId: 'deploy', status: 'done' }, { taskId: 'accept', status: 'done' }], milestones: [] }] };
      text = JSON.stringify(answer);
      if (question.includes('同步测试维修')) text = '处理结果如下：\n' + JSON.stringify(text);
    }
    const finish = () => response.end(JSON.stringify({ model: body.model, status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    if (hold) heldReply = finish;
    else finish();
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
const errors = [];
let application, page;
async function launch() {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
}
async function send(text) {
  await page.locator('#chat-input').fill(text);
  await page.locator('[data-action="chat-send"]').click();
  await page.waitForFunction(() => !state.chatSending, null, { timeout: 100000 });
  await assertComposerFixed();
  assert.equal(await page.locator('.chat-safety').count(), 0);
}
async function assertComposerFixed() {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  const layout = await page.evaluate(() => ({
    height: innerHeight, pageHeight: document.documentElement.scrollHeight,
    bottom: document.querySelector('.chat-composer').getBoundingClientRect().bottom,
    threadBottom: document.getElementById('chat-thread').getBoundingClientRect().bottom,
    composerTop: document.querySelector('.chat-composer').getBoundingClientRect().top
  }));
  assert.ok(layout.pageHeight <= layout.height + 1 && Math.abs(layout.bottom - layout.height) <= 2 &&
    layout.threadBottom <= layout.composerTop + 1, JSON.stringify(layout));
}
try {
  await launch();
  await page.locator('[data-action="model-settings"]').first().click();
  await page.locator('.provider-advanced summary').click();
  await page.locator('#custom-provider-name').fill('验收供应商');
  await page.locator('#custom-provider-base').fill(baseUrl);
  await page.locator('#custom-provider-key').fill(key);
  await page.waitForFunction(() => document.getElementById('custom-provider-model').value === 'semantic-model-a');
  await page.locator('#custom-provider-protocol').selectOption('responses');
  await page.locator('[data-action="save-profile"]').click();
  await page.waitForFunction(() => !document.getElementById('custom-provider-key'));
  assert.equal(await page.evaluate(() => aiProviderConfig().name), '验收供应商');
  assert.match(await page.locator('#topbar-ai-pill').innerText(), /semantic-model-a/);
  await page.locator('.nav [data-view="chat"]').click();
  await assertComposerFixed();
  assert.match(await page.locator('.chat-active-model').innerText(), /semantic-model-a/);
  const initial = await page.evaluate(() => ({ tasks: allWorkbenchTasks().length, inbox: DB.inbox.length,
    projects: DB.projects.length }));
  await send('解释一下关键路径。');
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-a');
  assert.match(await page.locator('.chat-bubble').last().innerText(), /模型 semantic-model-a.*关键路径/);
  assert.equal(await page.locator('[data-action="chat-apply"]').count(), 0);
  await send('再结合我的项目解释一次。');
  assert.ok(requests[1].input.some(item => item.role === 'assistant' && item.content.includes('最早完成时间')));
  assert.equal(await page.evaluate(() => DB.inbox.length), initial.inbox);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initial.tasks);
  await send('星火项目明天交给小陈验收，预计2小时。');
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initial.tasks);
  await page.locator('[data-action="chat-apply"]').first().click();
  await page.waitForFunction(() => allWorkbenchTasks().some(task => task.title === '语义验收任务'));
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initial.tasks + 1);
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-a');
  const task = await page.evaluate(() => allWorkbenchTasks().find(item => item.title === '语义验收任务'));
  assert.equal(task.assignee, '小陈');
  assert.equal(task.estimate, '2h');
  await send('星火项目整体调整到六成。');
  await page.locator('[data-action="chat-apply"]').first().click();
  assert.equal(await page.evaluate(() => projectById('p1').progress), 60);
  await send('帮我建立远山新计划，负责人小陈。');
  assert.equal(await page.evaluate(() => DB.projects.length), initial.projects);
  await page.locator('[data-action="chat-apply"]').first().click();
  assert.equal(await page.evaluate(() => DB.projects.length), initial.projects + 1);
  await page.evaluate(() => {
    DB.projects.push({ ...DB.projects[0], id: 'sync-project', name: '同步测试项目', progress: 0,
      next: '维修', nextDate: DB.meta.today });
    DB.projectDetails['sync-project'] = { ...detailForProject(projectById('sync-project')), activity: [], milestones: [
      { id: 'repair-ms', name: '维修', status: 'open', date: DB.meta.today, taskIds: ['repair-a', 'repair-b'] },
      { id: 'deploy-ms', name: '设备部署', status: 'open', date: addDaysISO(DB.meta.today, 2), taskIds: ['deploy'] },
      { id: 'accept-ms', name: '联调验收', status: 'open', date: addDaysISO(DB.meta.today, 3), taskIds: ['accept'] }] };
    for (const [id, title] of [['repair-a', '维修灯具'], ['repair-b', '维修门窗'], ['deploy', '设备部署'], ['accept', '联调验收']]) {
      addConfirmedTask({ id, title, project: 'sync-project', estimate: '1h', priority: 'P2', done: false,
        due: addDaysISO(DB.meta.today, -1) }, id === 'repair-a' ? addDaysISO(DB.meta.today, -3) : DB.meta.today, 'should');
    }
    DB.documents.push({ id: 'sync-document', title: '同步测试.pdf', content: '维修和部署',
      projectId: 'sync-project', analysis: { mode: '测试', tasks: [{ taskId: 'repair-a', title: '维修灯具' }] } });
    render();
  });
  const beforeSync = await page.evaluate(() => allWorkbenchTasks().length);
  await send('同步测试维修部分已经全部完成了');
  assert.equal(await page.evaluate(() => taskLocation('repair-a').task.done), true);
  assert.equal(await page.evaluate(() => taskLocation('deploy').task.done), false);
  assert.equal(await page.evaluate(() => projectById('sync-project').progress), 50);
  assert.equal(await page.evaluate(() => projectById('sync-project').next), '设备部署');
  assert.equal(await page.evaluate(() => DB.projectDetails['sync-project'].milestones[0].status), 'done');
  assert.equal(await page.evaluate(() => overdueTasks().some(task => task.id === 'repair-a')), false);
  assert.equal(await page.evaluate(() => DB.documents.find(doc => doc.id === 'sync-document').analysis.tasks[0].done), true);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), beforeSync);
  assert.match(await page.locator('.project-nav-item[data-id="sync-project"] .pcount').innerText(), /^2$/);
  assert.match(await page.locator('.chat-bubble').last().innerText(), /已同步 2 项任务/);
  assert.doesNotMatch(await page.locator('.chat-bubble').last().innerText(), /"actions"|\\n/);
  await page.screenshot({ path: join(evidence, 'chat-work-sync-desktop.png') });
  await send('设备部署正在进行中');
  assert.equal(await page.evaluate(() => taskLocation('deploy').task.status), '进行中');
  assert.match(await page.locator('.chat-bubble').last().innerText(), /进行中 1 项/);
  await page.locator('[data-action="project"][data-id="sync-project"]').first().click();
  await page.locator('.detail-tab[data-action="project-tab"][data-tab="milestones"]').click();
  assert.match(await page.locator('.milestone-row').first().innerText(), /维修.*已完成/s);
  await page.locator('.milestone-row [data-action="record-edit"]').first().click();
  assert.equal(await page.locator('[data-milestone-task]:checked').count(), 2);
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('.nav [data-view="reports"]').click();
  await page.evaluate(() => { state.report = 'daily'; state.reportDate = DB.meta.today; render(); });
  assert.match(await page.locator('#view').innerText(), /维修灯具/);
  await page.locator('.nav [data-view="chat"]').click();
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.isVisible());
    window.setMinimumSize(320, 640); window.setSize(496, 850);
  });
  await assertComposerFixed();
  await page.screenshot({ path: join(evidence, 'chat-work-sync-narrow.png') });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible()).setSize(1440, 1000));
  await send('设备部署完成，联调验收也完成了');
  assert.equal(await page.evaluate(() => projectById('sync-project').progress), 100);
  assert.equal(await page.evaluate(() => projectById('sync-project').status), '已完成');
  assert.equal(await page.evaluate(() => DB.projectDetails['sync-project'].milestones.every(item => item.status === 'done')), true);
  await page.locator('.nav [data-view="projects"]').click();
  assert.match(await page.locator('.project-card[data-id="sync-project"]').innerText(), /100%.*已完成/s);
  await page.locator('.nav [data-view="chat"]').click();
  denied = true;
  await send('失败后重试的问题。');
  assert.match(await page.locator('.chat-bubble').last().innerText(), /401.*鉴权失败/s);
  assert.equal((await page.locator('.chat-bubble').last().innerText()).includes(key), false);
  assert.equal(await page.locator('[data-action="chat-retry"]').count(), 1);
  denied = false;
  await page.locator('[data-action="chat-retry"]').click();
  await page.waitForFunction(() => !state.chatSending);
  assert.equal(await page.evaluate(() => state.chatMessages.filter(m => m.role === 'user' && m.text === '失败后重试的问题。').length), 1);
  assert.equal(await page.locator('[data-action="chat-retry"]').count(), 0);
  await page.locator('[data-action="model-settings"]').first().click();
  await page.locator('.provider-advanced summary').click();
  await page.locator('#custom-provider-model').fill('semantic-model-b');
  await page.locator('[data-action="save-profile"]').click();
  await page.waitForFunction(() => !document.getElementById('custom-provider-key'));
  assert.match(await page.locator('#topbar-ai-pill').innerText(), /semantic-model-b/);
  assert.match(await page.locator('.chat-active-model').innerText(), /semantic-model-b/);
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-a');
  await send('切换模型后继续回答。');
  assert.equal(requests.at(-1).model, 'semantic-model-b');
  assert.match(await page.locator('.chat-bubble').last().innerText(), /模型 semantic-model-b/);
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-b');
  assert.ok((await page.locator('.chat-message-model').allTextContents()).includes('semantic-model-a'));
  await page.locator('#chat-input').fill('等待期间切换模型。');
  await page.locator('[data-action="chat-send"]').click();
  for (let attempt = 0; attempt < 100 && !heldReply; attempt++) await page.waitForTimeout(50);
  assert.equal(typeof heldReply, 'function');
  await page.locator('[data-action="model-settings"]').first().click();
  await page.locator('.provider-advanced summary').click();
  await page.locator('#custom-provider-model').fill('semantic-model-a');
  await page.locator('[data-action="save-profile"]').click();
  await page.waitForFunction(() => !document.getElementById('custom-provider-key'));
  assert.match(await page.locator('.chat-active-model').innerText(), /semantic-model-a/);
  heldReply();
  await page.waitForFunction(() => !state.chatSending);
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-b');
  await send('下一次提问使用切换后的模型。');
  assert.equal(requests.at(-1).model, 'semantic-model-a');
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-a');
  await page.evaluate(() => persistWorkbench());
  await application.close();
  await launch();
  assert.match(await page.locator('#topbar-ai-pill').innerText(), /semantic-model-a/);
  await page.locator('.nav [data-view="chat"]').click();
  assert.match(await page.locator('.chat-active-model').innerText(), /semantic-model-a/);
  assert.equal(await page.locator('.chat-message-model').last().innerText(), 'semantic-model-a');
  assert.ok((await page.locator('.chat-message-model').allTextContents()).includes('semantic-model-b'));
  assert.equal(await page.evaluate(() => allWorkbenchTasks().filter(t => t.title === '语义验收任务').length), 1);
  assert.equal(await page.evaluate(() => DB.projects.filter(p => p.name === '远山新计划').length), 1);
  assert.equal(await page.evaluate(() => projectById('sync-project').progress), 100);
  assert.equal(await page.evaluate(() => taskLocation('repair-a').task.done), true);
  assert.equal(await page.evaluate(() => projectNotesFor('sync-project').filter(note => note.source === '对话状态同步').length), 3);
  assert.deepEqual(errors, []);
  const result = { passed: true, realIPCAndHTTP: true, homepageSynced: true,
    qaAndHistory: true, semanticTaskProgressAndProject: true, creationConfirmationRequired: true,
    workStatusAutoSync: true, linkedMilestonesAndProgress: true, overdueAndReportSync: true,
    failureRetry: true, modelSwitch: true, messageModelLabels: true, inFlightModelSwitch: true,
    safetyPanelRemoved: true, composerFixedAtBottom: true, persistedAcrossRestart: true, requests: requests.length, profile };
  writeFileSync(join(evidence, 'chat-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => 'Window unavailable'));
  throw error;
} finally { await application?.close(); server.closeAllConnections(); server.close(); }
