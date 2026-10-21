import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'interface-profile-'));
const exported = mkdtempSync(join(evidence, 'interface-exports-'));
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
const source = ['app.js', 'features.js'].map(name => readFileSync(join(root, 'prototype', name), 'utf8')).join('\n');
const knownActions = new Set([...source.matchAll(/case '([^']+)'/g)].map(match => match[1]));
knownActions.add('backdrop');
const observed = new Set();
const errors = [];
const application = await electron.launch({
  executablePath: process.env.XIAOYU_TEST_EXE || resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: process.env.XIAOYU_TEST_EXE ? [] : [resolve(root, 'out/main/index.js')],
  cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile, XIAOYU_EXPORT_DIR: exported }
});
let page = await application.firstWindow();
page.on('pageerror', error => errors.push(error.message));
const nav = async view => page.locator(`.nav [data-view="${view}"]`).click();
const close = async () => page.locator('#modal-root [data-action="close-modal"]').first().click();
const settle = async () => page.evaluate(() => Promise.all(document.getAnimations()
  .filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
async function audit(label) {
  await settle();
  const actions = await page.locator('button:enabled[data-action]').evaluateAll(elements => elements.map(el => el.dataset.action));
  actions.forEach(action => {
    observed.add(action);
    assert.ok(knownActions.has(action), `${label}: unhandled ${action}`);
    assert.notEqual(action, 'toast', `${label}: prototype toast remains`);
  });
  assert.equal(await page.locator('button:enabled:not([data-action])').count(), 0, `${label}: unlabeled behavior`);
}
try {
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async (_owner, options) => ({
      canceled: false, filePath: process.env.XIAOYU_EXPORT_DIR + '/' + options.defaultPath
    });
  });
  for (const view of ['today', 'chat', 'inbox', 'projects', 'reports', 'profile', 'data']) {
    await nav(view);
    await audit(view);
    await page.screenshot({ path: join(evidence, `audit-${view}.png`), scale: 'css' });
  }
  await nav('today');
  const taskId = await page.locator('.task-row').first().getAttribute('data-task');
  await page.locator(`[data-task="${taskId}"] [data-action="task-timer"]`).click();
  await page.waitForFunction(id => DB.runningTimer?.taskId === id, taskId);
  await page.locator(`[data-task="${taskId}"] [data-action="task-timer"]`).click();
  await page.waitForFunction(() => !DB.runningTimer && DB.timeEntries.length === 1);
  await page.locator(`[data-task="${taskId}"] [data-action="task-edit"]`).click();
  await audit('task editor');
  const tomorrow = await page.evaluate(() => addDaysISO(DB.meta.today, 1));
  await page.locator('#task-title').fill('逐页核查改期任务');
  await page.locator('#task-date').fill(tomorrow);
  await page.locator('#task-status').selectOption('doing');
  await page.locator('[data-action="task-save"]').click();
  await page.waitForFunction(({ taskId, tomorrow }) => taskLocation(taskId).date === tomorrow, { taskId, tomorrow });
  assert.equal(await page.evaluate(id => taskLocation(id).task.status, taskId), '进行中');
  await page.locator('[data-action="task-filter"]').first().click();
  await page.locator('#filter-status').selectOption('done');
  await page.locator('[data-action="task-filter-save"]').click();
  assert.equal(await page.locator('.task-row:not(.done)').count(), 0);
  await page.locator('[data-action="task-filter"]').first().click();
  await page.locator('#filter-status').selectOption('');
  await page.locator('[data-action="task-filter-save"]').click();
  await page.locator('[data-action="work-hours"]').click();
  await page.locator('#work-start').fill('08:30');
  await page.locator('[data-action="work-hours-save"]').click();
  await page.waitForFunction(() => DB.workday.start === '08:30');
  await page.locator('[data-action="waiting"]').click();
  await audit('waiting');
  await page.locator('[data-action="record-edit"][data-kind="waiting"]').last().click();
  await page.locator('#record-title').fill('核查等待事项');
  await page.locator('[data-action="record-save"]').click();
  await page.waitForFunction(() => DB.waiting.some(w => w.title === '核查等待事项'));
  await page.locator('[data-action="notifications"]').click(); await audit('notifications'); await close();
  await page.locator('[data-action="overdue"]').click(); await audit('overdue'); await close();
  await page.locator('[data-action="impact"]').click();
  await page.locator('#impact-title').fill('核查插单排期');
  await page.locator('#impact-mode').selectOption('nextweek');
  await page.locator('[data-action="impact-preview"]').click();
  await audit('impact confirmation');
  assert.equal(await page.evaluate(() => allWorkbenchTasks().some(t => t.title === '核查插单排期')), false);
  await page.locator('[data-action="impact-confirm"]').click();
  await page.waitForFunction(() => allWorkbenchTasks().some(t => t.title === '核查插单排期'));

  await nav('inbox');
  const inboxId = await page.evaluate(() => DB.inbox[0].id);
  await page.locator('[data-action="inbox-ignore"]').click();
  await page.waitForFunction(id => !DB.inbox.some(i => i.id === id), inboxId);
  await page.locator('[data-action="inbox-archive"]').click();
  await page.locator(`[data-action="inbox-restore"][data-id="${inboxId}"]`).click();
  await page.waitForFunction(id => DB.inbox.some(i => i.id === id), inboxId);
  await page.locator('[data-action="inbox-split"]').click();
  await page.locator('#split-titles').fill('拆分验收甲\n拆分验收乙');
  await page.locator('[data-action="inbox-split-confirm"]').click();
  await page.waitForFunction(() => DB.inbox.some(i => i.title === '拆分验收甲'));
  await page.locator('[data-action="inbox-batch"]').click();
  await page.locator('[name="archive-inbox"]').first().check();
  await page.locator('[data-action="inbox-batch-confirm"]').click();

  await nav('projects');
  await page.locator('[data-action="project-export"]').click();
  await page.waitForFunction(() => document.getElementById('toast-root').textContent.includes('文件已导出'));
  await page.locator('.project-card').first().click();
  for (const tab of ['overview', 'tasks', 'milestones', 'risks', 'notes', 'docs']) {
    await page.locator(`[data-action="project-tab"][data-tab="${tab}"]`).last().click();
    await audit('project ' + tab);
  }
  await page.locator('[data-action="document-upload"]').click();
  await page.locator('#text-file').setInputFiles({ name: '核查文档.md', mimeType: 'text/markdown', buffer: Buffer.from('# 真实文档\n正文 <script>不可执行</script>') });
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => DB.documents.some(d => d.title === '核查文档.md'));
  const documentId = await page.evaluate(() => DB.documents[0].id);
  await page.locator(`[data-action="document-open"][data-id="${documentId}"]`).click();
  assert.match(await page.locator('.document-content').innerText(), /真实文档/);
  assert.equal(await page.locator('.document-content script').count(), 0);
  await close();
  await page.locator('[data-action="project-tab"][data-tab="risks"]').click();
  await page.locator('[data-action="record-edit"][data-kind="risk"]').last().click();
  await page.locator('#record-title').fill('核查新增风险');
  await page.locator('[data-action="record-save"]').click();
  await page.waitForFunction(() => DB.projectDetails[state.projectId].risks.some(r => r.title === '核查新增风险'));
  await page.locator('[data-action="project-tab"][data-tab="milestones"]').click();
  await page.locator('[data-action="record-edit"][data-kind="milestone"]').first().click();
  await page.locator('#record-title').fill('核查里程碑');
  await page.locator('[data-action="record-save"]').click();
  await page.locator('[data-action="milestone-follow"]').click();
  await page.locator('[data-action="project-tab"][data-tab="tasks"]').click();
  await page.locator('[data-action="project-board"]').click();
  assert.equal(await page.locator('.task-board').count(), 1);
  await settle();
  await page.screenshot({ path: join(evidence, 'audit-board.png'), scale: 'css' });

  await nav('reports');
  for (const report of ['daily', 'weekly', 'monthly', 'project', 'risk', 'requirements']) {
    await page.locator(`[data-action="report"][data-report="${report}"]`).click();
    await audit(report + ' report');
  }
  await page.locator('[data-action="report"][data-report="weekly"]').click();
  await page.locator('[data-action="report-edit"]').click();
  await page.locator('#report-editor-text').fill('人工编辑验收正文\n完整保留中文内容');
  await page.locator('[data-action="report-editor-save"]').click();
  await page.waitForFunction(() => currentReport().edited);
  for (const format of ['md', 'docx', 'xlsx', 'pdf']) {
    await page.locator('#report-export-format').selectOption(format);
    await page.locator('[data-action="report-export"]').click();
    const title = await page.evaluate(() => currentReport().title);
    const path = join(exported, title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.' + format);
    for (let attempt = 0; attempt < 100 && !existsSync(path); attempt++) await page.waitForTimeout(100);
    assert.ok(existsSync(path), format + ' was not exported');
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 10);
    if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    if (format === 'docx') assert.ok(bytes.includes(Buffer.from('word/document.xml')));
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(path);
      assert.ok(JSON.stringify(workbook.getWorksheet('报表').getSheetValues()).includes('人工编辑验收正文'));
    }
  }
  await page.locator('[data-action="report-regenerate"]').click();
  await page.waitForFunction(() => !currentReport().edited);
  await nav('profile');
  await page.locator('#profile-period').selectOption('7');
  await page.locator('[data-action="record-edit"][data-kind="experiment"]').click();
  await page.locator('#record-title').fill('核查两周实验');
  await page.locator('[data-action="record-save"]').click();
  await page.waitForFunction(() => DB.experiments.some(e => e.title === '核查两周实验'));

  await nav('data');
  await page.locator('[data-action="record-edit"][data-kind="field"]').first().click();
  await page.locator('#record-title').fill('核查扩展字段');
  await page.locator('#record-type').selectOption('单选');
  await page.locator('#record-options').fill('待确认\n已确认');
  await page.locator('[data-action="record-save"]').click();
  await page.waitForFunction(() => DB.fields.task.some(f => f.name === '核查扩展字段'));
  await nav('today');
  await page.locator('.task-row [data-action="task-edit"]').first().click();
  const customFieldId = await page.evaluate(() => DB.fields.task.find(f => f.name === '核查扩展字段').id);
  await page.locator('#custom-' + customFieldId).selectOption('已确认');
  const customTaskId = await page.evaluate(() => state.editTaskId);
  await page.locator('[data-action="task-save"]').click();
  await page.waitForFunction(({ id, field }) => taskLocation(id).task.customValues?.[field] === '已确认',
    { id: customTaskId, field: customFieldId });
  await nav('data');
  await page.evaluate(() => { DB.settings.deepseekKey = 'qa-export-private-key'; saveSettings(); });
  await page.locator('[data-action="data-export"]').click();
  for (let attempt = 0; attempt < 100 && !readdirSync(exported).some(f => extname(f) === '.json'); attempt++) await page.waitForTimeout(100);
  const json = JSON.parse(readFileSync(join(exported, readdirSync(exported).find(f => extname(f) === '.json')), 'utf8'));
  assert.equal(JSON.stringify(json).includes('qa-export-private-key'), false);
  await page.locator('[data-action="data-backup"]').click();
  await page.waitForFunction(() => !!DB.meta.lastBackup);
  const backup = join(exported, readdirSync(exported).find(f => extname(f) === '.sqlite'));
  const database = new DatabaseSync(backup, { readOnly: true });
  assert.ok(database.prepare('SELECT count(*) AS n FROM projects').get().n > 0);
  assert.equal(readFileSync(backup).includes(Buffer.from('qa-export-private-key')), false);
  database.close();
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.evaluate(() => DB.documents.length), 1);
  assert.equal(await page.evaluate(() => DB.experiments[0].title), '核查两周实验');
  assert.equal(await page.evaluate(() => DB.workday.start), '08:30');
  assert.equal(await page.evaluate(() => DB.fields.task.some(f => f.name === '核查扩展字段')), true);
  assert.deepEqual(errors, []);
  const result = { passed: true, views: 7, projectTabs: 6, reportTypes: 6, actions: [...observed].sort(), exported: readdirSync(exported), profile };
  writeFileSync(join(evidence, 'interface-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'interface-failure.png'), scale: 'css' }).catch(() => {});
  console.error(await page.locator('body').innerText().catch(() => 'Window unavailable'));
  throw error;
} finally { await application.close(); }
