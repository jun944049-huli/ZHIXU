import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const dataDirectory = process.env.XIAOYU_TEST_DATA_DIR || mkdtempSync(join(evidence, 'profile-'));
const errors = [];
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
  await page.screenshot({ path: join(evidence, 'desktop-daily-report.png'), scale: 'css' });
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
  await page.screenshot({ path: join(evidence, 'desktop-projects.png'), scale: 'css' });
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
    archives: DB.projectArchive.length
  }));
  assert.deepEqual(recovered, {
    done: true, confirmed: true, sources: 3, inbox: inboxBefore - 1,
    closeFlush: 'saved-on-close', secretRecovered: true,
    projectRemoved: true, taskPreserved: true, archives: 2
  });
  const database = new DatabaseSync(join(dataDirectory, 'workbench.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT count(*) AS count FROM projects WHERE id IN (?, ?)').get(projectId, 'p1').count, 0);
    assert.equal(database.prepare('SELECT project_id FROM tasks WHERE title = ?').get('项目关联验收任务').project_id, null);
    assert.equal(database.prepare('SELECT done FROM tasks WHERE id = ?').get(taskId).done, 1);
  } finally { database.close(); }
  for (const file of ['workbench.sqlite', 'workbench.sqlite-wal']) {
    assert.equal(readFileSync(join(dataDirectory, file)).includes(Buffer.from('qa-test-secret-key')), false);
  }
  await finishAnimations(page);
  await page.screenshot({ path: join(evidence, 'desktop-after-restart.png'), scale: 'css' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, dataDirectory, recovered }));
} catch (error) {
  if (application) {
    const page = application.windows()[0];
    if (page) {
      await page.screenshot({ path: join(evidence, 'desktop-failure.png') }).catch(() => {});
      console.error(await page.locator('body').innerText().catch(() => 'No page content'));
    }
  }
  throw error;
} finally {
  await application?.close().catch(() => {});
}
