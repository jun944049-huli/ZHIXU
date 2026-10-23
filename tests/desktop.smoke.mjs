import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const dataDirectory = process.env.XIAOYU_TEST_DATA_DIR || mkdtempSync(join(evidence, 'profile-'));
const errors = [];
async function screenshot(page, name) {
  if (process.env.XIAOYU_SKIP_SCREENSHOTS === '1') return;
  await page.screenshot({ path: join(evidence, name), scale: 'css', timeout: 15000 });
}
const calendarStart = new Date();
calendarStart.setDate(calendarStart.getDate() + 1);
const calendarEnd = new Date(calendarStart.getTime() + 3600000);
const calendarDate = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const calendarServer = createServer((request, response) => {
  if (request.url.startsWith('/invalid')) {
    response.end('<html>Login required</html>');
    return;
  }
  response.setHeader('Content-Type', 'text/calendar');
  response.end([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:desktop-integration-qa',
    `DTSTART:${calendarDate(calendarStart)}`, `DTEND:${calendarDate(calendarEnd)}`,
    'SUMMARY:连接器日历验收', 'DESCRIPTION:真实网络请求导入原文', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n'));
});
calendarServer.listen(0, '127.0.0.1');
await once(calendarServer, 'listening');
const calendarPort = calendarServer.address().port;
const calendarUrl = `http://127.0.0.1:${calendarPort}/feed?token=qa-subscription-secret`;
const executablePath = process.env.XIAOYU_TEST_EXE ||
  resolve(root, 'node_modules/electron/dist/electron.exe');
const { ELECTRON_RUN_AS_NODE, ...electronEnvironment } = process.env;
const launch = () => electron.launch({
  executablePath,
  args: process.env.XIAOYU_TEST_EXE ? [] : [resolve(root, 'out/main/index.js')],
  cwd: root,
  env: { ...electronEnvironment, XIAOYU_DATA_DIR: dataDirectory },
  timeout: 30000
});
const finishAnimations = page => page.evaluate(() => Promise.all(
  document.getAnimations().filter(animation =>
    animation.effect?.getComputedTiming().iterations !== Infinity
  ).map(animation => animation.finished.catch(() => {}))
));

let application;
try {
  application = await launch();
  let page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length > 0);
  assert.match(await page.title(), /知序/);
  assert.equal(await page.locator('.brand-name').innerText(), '知序');
  assert.ok(await page.locator('.brand-image').first().evaluate(image => image.complete && image.naturalWidth > 0));
  assert.equal(await page.evaluate(() => typeof window.xiaoyuDesktop?.save), 'function');
  await page.locator('[data-action="capture"]').first().click();
  await page.locator('#capture-text').fill('星火项目：桌面端持久化验收任务，预计 1 小时，今天完成。');
  await page.locator('#parse-btn').click();
  await page.locator('#capture-title').fill('桌面端持久化验收任务');
  await page.locator('[data-action="confirm-capture"]').click();
  await page.waitForFunction(() =>
    [...DB.tasks.must, ...DB.tasks.should].some(t => t.title === '桌面端持久化验收任务'));
  const taskId = await page.evaluate(() =>
    [...DB.tasks.must, ...DB.tasks.should].find(t => t.title === '桌面端持久化验收任务').id);
  await page.locator(`[data-task="${taskId}"] [data-action="check"]`).click();
  await page.waitForFunction(id =>
    DB.tasks.must.some(t => t.id === id && t.done), taskId);
  await page.locator('[data-action="nav"][data-view="inbox"]').click();
  const inboxBefore = await page.evaluate(() => DB.inbox.length);
  await page.locator('#inbox-task-title').fill('已确认的收件箱验收任务');
  await page.locator('[data-action="confirm-inbox"]').click();
  await page.waitForFunction(count => DB.inbox.length === count - 1, inboxBefore);
  await page.locator('[data-action="nav"][data-view="reports"]').click();
  await page.locator('[data-report="daily"]').click();
  await page.waitForFunction(() =>
    document.querySelector('.report-body')?.textContent.includes('桌面端持久化验收任务'));
  await finishAnimations(page);
  await screenshot(page, 'desktop-daily-report.png');
  await page.evaluate(() => persistWorkbench());
  const persisted = await page.evaluate(() => window.xiaoyuDesktop.load());
  assert.equal(persisted.db.sourceItems.length, 2);
  const savedProbe = await page.evaluate(async () => {
    DB.meta.queueProbe = 'initial';
    await persistWorkbench();
    DB.meta.queueProbe = 'temporary';
    const firstSave = persistWorkbench();
    DB.meta.queueProbe = 'initial';
    const secondSave = persistWorkbench();
    await Promise.all([firstSave, secondSave]);
    return (await window.xiaoyuDesktop.load()).db.meta.queueProbe;
  });
  assert.equal(savedProbe, 'initial');
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator('#view [data-action="new-project"]').click();
  await page.locator('[data-action="save-project"]').click();
  assert.equal(await page.locator('.project-editor[role="dialog"]').count(), 1);
  await page.locator('#project-name').fill('桌面项目验收');
  await page.locator('#project-goal').fill('新增编辑删除及关联任务持久化');
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => DB.projects.some(p => p.name === '桌面项目验收'));
  const projectId = await page.evaluate(() => state.projectId);
  await page.locator('[data-action="edit-project"]').click();
  await page.locator('#project-name').fill('桌面项目验收已编辑');
  await page.locator('.project-advanced summary').click();
  await page.locator('#project-progress').fill('0');
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => document.querySelector('#view h1')?.textContent === '桌面项目验收已编辑');
  await page.locator('[data-action="project-task"]').click();
  await page.locator('#capture-text').fill('保存项目关联验收任务，预计 1 小时');
  await page.locator('#parse-btn').click();
  await page.locator('#capture-title').fill('项目关联验收任务');
  assert.equal(await page.locator('#capture-project').inputValue(), projectId);
  await page.locator('[data-action="confirm-capture"]').click();
  await page.waitForFunction(() => DB.tasks.must.some(t => t.title === '项目关联验收任务'));
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator(`.project-card[data-id="${projectId}"]`).click();
  await page.locator('[data-action="project-tab"][data-tab="tasks"]').click();
  assert.match(await page.locator('.task-table').innerText(), /项目关联验收任务/);
  await page.locator('[data-action="delete-project"]').click();
  await page.locator('[aria-label="删除项目"] [data-action="close-modal"]').last().click();
  assert.equal(await page.evaluate(id => !!projectById(id), projectId), true);
  await page.locator('[data-action="delete-project"]').click();
  await page.locator('[data-action="confirm-delete-project"]').click();
  await page.waitForFunction(id => !projectById(id), projectId);
  assert.equal(await page.evaluate(() => DB.tasks.must.find(t => t.title === '项目关联验收任务').project), null);
  await page.locator('[data-action="project-display"][data-mode="list"]').click();
  await page.locator('[data-project-row="p1"] [data-action="delete-project"]').click();
  await page.locator('[data-action="confirm-delete-project"]').click();
  await page.waitForFunction(() => !projectById('p1'));
  assert.equal(await page.evaluate(() => allWorkbenchTasks().some(t => t.project === 'p1')), false);
  for (const view of ['chat', 'inbox', 'projects', 'reports', 'profile', 'data', 'today']) {
    await page.locator(`[data-action="nav"][data-view="${view}"]`).first().click();
    assert.ok((await page.locator('#view').innerText()).length > 0, view);
  }
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator('.project-register').scrollIntoViewIfNeeded();
  await finishAnimations(page);
  await screenshot(page, 'desktop-projects.png');
  await page.locator('[data-action="nav"][data-view="data"]').click();
  for (const id of ['feishu', 'dingtalk', 'wecom', 'mail', 'ics']) {
    await page.locator(`.connector-card[data-id="${id}"]`).click();
    assert.equal(await page.locator('.integration-modal').count(), 1);
    await page.locator('.integration-modal [data-action="close-modal"]').click();
  }
  assert.match(await page.locator('.connector-card[data-id="feishu"]').innerText(), /未配置/);
  await page.locator('.connector-card[data-id="ics"]').click();
  await page.locator('#integration-url').fill(`http://127.0.0.1:${calendarPort}/invalid?token=qa-subscription-secret`);
  await page.locator('[data-action="connector-test"]').click();
  await page.waitForFunction(() => DB.integrationState.ics?.status === 'error');
  assert.match(await page.locator('#integration-result').innerText(), /ICS/);
  assert.equal(await page.evaluate(() => integrationStatus('ics').on), false);
  await page.locator('#integration-url').fill(calendarUrl);
  await page.locator('[data-action="connector-test"]').click();
  await page.waitForFunction(() => DB.integrationState.ics?.status === 'verified');
  const inboxBeforeSync = await page.evaluate(() => DB.inbox.length);
  await page.locator('[data-action="connector-sync"]').click();
  await page.waitForFunction(() => DB.inbox.some(item => item.title === '连接器日历验收'));
  await page.waitForFunction(() => !state.integrationBusy.ics);
  await page.locator('[data-action="connector-sync"]').click();
  await page.waitForFunction(() => DB.integrationLogs.filter(log => log.connectorId === 'ics' && log.action === 'sync').length === 2);
  assert.equal(await page.evaluate(() => DB.inbox.length), inboxBeforeSync + 1);
  await finishAnimations(page);
  await screenshot(page, 'desktop-integration-ics.png');
  await page.locator('.integration-modal [data-action="close-modal"]').click();
  await page.locator('.connector-card[data-id="dingtalk"]').click();
  await page.locator('#integration-appKey').fill('qa-dingtalk-app');
  await page.locator('#integration-appSecret').fill('qa-integration-secret');
  await page.locator('[data-action="connector-save"]').click();
  await page.waitForFunction(() => DB.settings.integrations.dingtalk?.appSecret === 'qa-integration-secret');
  await page.locator('.integration-modal [data-action="close-modal"]').click();
  await page.locator('[data-action="connector-logs"]').click();
  assert.match(await page.locator('.integration-log-list').innerText(), /ICS|日历/);
  assert.equal((await page.locator('.integration-log-list').innerText()).includes('qa-subscription-secret'), false);
  await page.locator('[aria-label="同步日志"] [data-action="close-modal"]').click();
  await page.evaluate(() => {
    DB.meta.closeFlushMarker = 'saved-on-close';
    DB.settings.deepseekKey = 'qa-test-secret-key';
  });
  await application.close();

  application = await launch();
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length > 0);
  const recovered = await page.evaluate(() => ({
    done: DB.tasks.must.find(t => t.title === '桌面端持久化验收任务')?.done,
    confirmed: [...DB.tasks.must, ...DB.tasks.should].some(t => t.title === '已确认的收件箱验收任务'),
    sources: DB.sourceItems.length, inbox: DB.inbox.length,
    closeFlush: DB.meta.closeFlushMarker,
    secretRecovered: DB.settings.deepseekKey === 'qa-test-secret-key',
    projectRemoved: !DB.projects.some(p => p.name === '桌面项目验收已编辑') && !projectById('p1'),
    taskPreserved: DB.tasks.must.find(t => t.title === '项目关联验收任务')?.project === null,
    archives: DB.projectArchive.length,
    calendarVerified: DB.integrationState.ics?.status === 'verified',
    connectorSecret: DB.settings.integrations.dingtalk?.appSecret === 'qa-integration-secret',
    calendarImported: DB.inbox.filter(item => item.title === '连接器日历验收').length
  }));
  assert.deepEqual(recovered, {
    done: true, confirmed: true, sources: 3, inbox: inboxBefore,
    closeFlush: 'saved-on-close', secretRecovered: true,
    projectRemoved: true, taskPreserved: true, archives: 2,
    calendarVerified: true, connectorSecret: true, calendarImported: 1
  });
  const database = new DatabaseSync(join(dataDirectory, 'workbench.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT count(*) AS count FROM projects WHERE id IN (?, ?)').get(projectId, 'p1').count, 0);
    assert.equal(database.prepare('SELECT project_id FROM tasks WHERE title = ?').get('项目关联验收任务').project_id, null);
    assert.equal(database.prepare('SELECT done FROM tasks WHERE id = ?').get(taskId).done, 1);
  } finally { database.close(); }
  for (const file of ['workbench.sqlite', 'workbench.sqlite-wal']) {
    for (const secret of ['qa-test-secret-key', 'qa-integration-secret', 'qa-subscription-secret']) {
      assert.equal(readFileSync(join(dataDirectory, file)).includes(Buffer.from(secret)), false);
    }
  }
  await page.locator('[data-action="nav"][data-view="data"]').click();
  await page.locator('.connector-card[data-id="dingtalk"]').click();
  assert.equal(await page.locator('#integration-appSecret').inputValue(), '');
  assert.match(await page.locator('#integration-appSecret').getAttribute('placeholder'), /已保存/);
  await page.locator('[data-action="connector-disconnect"]').click();
  await page.waitForFunction(() => !DB.settings.integrations.dingtalk);
  await page.evaluate(() => persistWorkbench());
  assert.equal(await page.evaluate(async () => !!(await window.xiaoyuDesktop.load()).db.settings.integrations.dingtalk), false);
  await finishAnimations(page);
  await screenshot(page, 'desktop-integrations.png');
  await finishAnimations(page);
  await screenshot(page, 'desktop-after-restart.png');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, dataDirectory, recovered }));
} catch (error) {
  if (application) {
    const page = application.windows()[0];
    if (page) {
      if (process.env.XIAOYU_SKIP_SCREENSHOTS !== '1') {
        await page.screenshot({ path: join(evidence, 'desktop-failure.png'), timeout: 5000 }).catch(() => {});
      }
      console.error(await page.locator('body').innerText().catch(() => 'No page content'));
    }
  }
  throw error;
} finally {
  await application?.close().catch(() => {});
  calendarServer.closeAllConnections();
  calendarServer.close();
}
