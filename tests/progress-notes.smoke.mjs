import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'progress-notes-profile-'));
const requests = [];
const server = createServer((request, response) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    assert.equal(request.headers.authorization, 'Bearer isolated-notes-key');
    const body = JSON.parse(raw);
    requests.push(body);
    assert.match(body.input[0].content, /不覆盖历史/);
    const question = body.input.at(-1).content;
    const action = question.includes('校方') ? {
      type: 'work_update', projectId: 'p1', note: '校方已确认验收结果，等待归档资料', tasks: [], milestones: []
    } : { type: 'work_update', projectId: 'p1', note: '灯具维修交付完成，现场检查通过',
      tasks: [{ taskId: 'qa-progress', status: 'done', note: '灯具已修复，现场检查通过，无遗留问题' }], milestones: [] };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ model: 'project-notes-model', output: [{ content: [{ type: 'output_text',
      text: JSON.stringify({ reply: '进展已整理。', actions: [action] }) }] }] }));
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function openNotes() {
  await page.evaluate(() => { state.view = 'project'; state.projectId = 'p1'; state.projectTab = 'tasks'; render(); });
  await page.locator('.task-history-link[data-id="qa-progress"]').click();
}
async function saveEditor() {
  await page.locator('[data-action="task-save"]').click();
  await page.waitForFunction(() => !document.querySelector('.task-editor'));
  await page.evaluate(() => persistWorkbench());
}
async function send(text) {
  await page.locator('#chat-input').fill(text);
  await page.locator('[data-action="chat-send"]').click();
  await page.waitForFunction(() => !state.chatSending);
}
try {
  await launch();
  await page.evaluate(() => {
    DB.tasks = { must: [], should: [], could: [] }; DB.taskCalendar = {}; DB.overdue = []; DB.projectNotes = {};
    DB.projectDetails.p1.milestones = [{ id: 'qa-mile', name: '灯具交付', date: '2026-11-01', status: 'open', taskIds: ['qa-progress'] }];
    addConfirmedTask({ id: 'qa-progress', title: '维修灯具', project: 'p1', due: '待校方确认',
      priority: 'P2', estimate: '1h', note: '附件原始说明：核对灯具数量', done: false }, DB.meta.today, 'should');
    reconcileProjectWork(['p1']);
  });
  await openNotes();
  assert.equal(await page.locator('#task-due').getAttribute('type'), 'date');
  assert.equal(await page.locator('label[for="task-due"]').innerText(), '截止日期');
  assert.equal(await page.locator('#task-due').inputValue(), '');
  assert.equal(await page.locator('#task-note').inputValue(), '');
  assert.match(await page.locator('.task-note-history').innerText(), /时间未记录/);
  await page.locator('#task-due').fill('2026-11-05');
  await page.locator('#task-status').selectOption('doing');
  await page.locator('#task-progress').fill('40');
  await page.locator('#task-note').fill('已检查线路，等待更换配件');
  await page.locator('#task-due').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'progress-date-picker.png'), animations: 'disabled' });
  await saveEditor();
  await openNotes();
  assert.equal(await page.locator('.task-history-entry').count(), 2);
  assert.equal(await page.locator('#task-note').inputValue(), '');
  assert.match(await page.locator('.task-legacy-due').innerText(), /待校方确认/);
  await page.locator('#task-status').selectOption('done');
  assert.equal(await page.locator('#task-progress').inputValue(), '100');
  await page.locator('#task-note').fill('配件更换完成，现场验收通过');
  await saveEditor();
  assert.equal(await page.evaluate(() => projectById('p1').progress), 100);
  assert.equal(await page.evaluate(() => DB.projectDetails.p1.milestones[0].status), 'done');
  await page.evaluate(baseUrl => {
    DB.settings.aiProvider = 'custom'; DB.settings.customProvider = {
      name: '测试供应商', baseUrl, apiKey: 'isolated-notes-key', model: 'project-notes-model', protocol: 'responses'
    };
    state.view = 'chat'; state.chatContext = 'p1'; render();
  }, `http://127.0.0.1:${server.address().port}`);
  const raw = '灯都弄好啦，检查也过了，没有别的问题';
  await send(raw);
  assert.equal(await page.evaluate(() => taskNotesFor(taskLocation('qa-progress').task)[0].text), '灯具已修复，现场检查通过，无遗留问题');
  assert.equal(await page.evaluate(() => taskNotesFor(taskLocation('qa-progress').task)[0].raw), raw);
  assert.equal(await page.evaluate(() => taskNotesFor(taskLocation('qa-progress').task).length), 4);
  await send('记录一下，校方说验收没问题，等资料归档');
  assert.equal(await page.evaluate(() => projectById('p1').progress), 100);
  assert.equal(await page.evaluate(() => projectNotesFor('p1')[0].text), '校方已确认验收结果，等待归档资料');
  const count = await page.evaluate(() => projectNotesFor('p1').length);
  await send('如果灯具都完成了，可以进行验收吗？');
  assert.equal(await page.evaluate(() => state.chatMessages.at(-1).actionCard.status), 'pending');
  assert.equal(await page.evaluate(() => projectNotesFor('p1').length), count);
  await page.evaluate(() => { cancelChat(); persistWorkbench(); });
  await openNotes();
  assert.equal(await page.locator('.task-history-entry').count(), 4);
  assert.match(await page.locator('.task-history-entry').first().innerText(), /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  await page.locator('.task-note-history').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'progress-notes-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 496, height: 604 });
  await page.locator('.task-note-history').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.task-editor').evaluate(el => el.scrollWidth > el.clientWidth), false);
  assert.equal(await page.locator('[data-action="task-save"]').isVisible(), true);
  await page.screenshot({ path: join(evidence, 'progress-notes-narrow.png'), animations: 'disabled' });
  await page.locator('[data-action="close-modal"]').click();
  await page.evaluate(() => { state.projectTab = 'notes'; render(); });
  const projectRows = await page.locator('.note-table tbody tr').count();
  assert.equal(projectRows, count);
  assert.ok(projectRows >= 5);
  await page.evaluate(() => persistWorkbench());
  await app.close(); app = null;
  await launch();
  assert.equal(await page.evaluate(() => taskNotesFor(taskLocation('qa-progress').task).length), 4);
  assert.equal(await page.evaluate(() => taskLocation('qa-progress').task.note), '附件原始说明：核对灯具数量');
  assert.equal(await page.evaluate(() => taskLocation('qa-progress').task.due), '2026-11-05');
  assert.equal(await page.evaluate(() => projectNotesFor('p1').length), count);
  await openNotes();
  await page.locator('#task-due').fill('');
  await saveEditor();
  await app.close(); app = null;
  await launch();
  assert.equal(await page.evaluate(() => taskDeadlineDate(taskLocation('qa-progress').task)), null);
  assert.equal(await page.evaluate(() => taskNotesFor(taskLocation('qa-progress').task).length), 4);
  assert.equal(requests.length, 3);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, appendAndLegacy: true, datePicker: true,
    modelAndProjectNotes: true, questionNeedsConfirmation: true, narrowAndDesktop: true, restartAndClear: true, profile }));
} finally {
  if (app) await app.close();
  server.closeAllConnections(); server.close();
}
