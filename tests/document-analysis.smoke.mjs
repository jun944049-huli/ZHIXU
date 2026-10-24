import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'analysis-profile-'));
const requests = [];
const server = createServer((request, response) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    assert.equal(request.headers.authorization, 'Bearer isolated-analysis-key');
    assert.equal(request.url, '/v1/chat/completions');
    const body = JSON.parse(raw);
    const input = JSON.parse(body.messages[1].content);
    requests.push(input);
    const task = (title, details, sourceTaskIds, quote) => ({
      title, details, sourceTaskIds, evidence: quote, assignee: '', due: '', priority: 'P2', estimateHours: 0
    });
    const tasks = input.existingTasks.length
      ? [task('完成维修交付', '门窗与灯具维修、联检和验收', input.existingTasks.map(item => item.id), '完成门窗维修')]
      : [task('完成门窗交付', '完成门窗维修\n提交门窗验收', [], '完成门窗维修'),
        task('完成灯具交付', '完成灯具维修\n提交灯具验收', [], '完成灯具维修')];
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      summary: '按交付阶段整理维修工作，保留验收要求。', projectId: 'p1', projectName: '星火项目', tasks
    }) } }] }));
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let application;
try {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.evaluate(port => {
    DB.tasks = { must: [], should: [], could: [] };
    DB.taskCalendar = {};
    DB.documents = [];
    DB.projects = DB.projects.filter(project => project.id === 'p1');
    DB.projectDetails.p1.milestones = [];
    DB.settings.aiProvider = 'custom';
    DB.settings.customProvider = { name: '分析测试供应商', baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'isolated-analysis-key', model: 'analysis-model', protocol: 'chat' };
    state.view = 'chat';
    render();
  }, server.address().port);
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles({ name: '维修交付.md', mimeType: 'text/markdown',
    buffer: Buffer.from('星火项目\n完成门窗维修\n提交门窗验收\n完成灯具维修\n提交灯具验收') });
  await page.locator('#document-engine').selectOption('ai');
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.equal(await page.locator('#modal-root .modal').count(), 0);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), 2);
  assert.match(await page.locator('#chat-thread').innerText(), /按交付阶段/);
  const id = await page.evaluate(() => DB.documents[0].id);
  const taskId = await page.evaluate(() => DB.documents[0].analysis.tasks[0].taskId);
  await page.evaluate(id => toggleTask(id), taskId);
  const progress = await page.evaluate(() => projectById('p1').progress);
  await page.locator(`[data-action="document-chat-details"][data-id="${id}"]`).click();
  await page.locator('[data-action="document-reanalyze"]').click();
  await page.locator('[data-action="document-reanalyze-confirm"]').click();
  await page.waitForFunction(() => !state.documentAnalyzing);
  assert.equal(await page.locator('#modal-root .modal').count(), 0);
  assert.match(await page.locator('#chat-thread').innerText(), /等待保存/);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), 2);
  await page.locator(`[data-action="document-chat-details"][data-id="${id}"]`).click();
  assert.equal(await page.locator('.document-task-row').count(), 1);
  assert.match(await page.locator('#draft-details-0').inputValue(), /提交灯具验收/);
  await page.locator('[data-action="document-apply"]').click();
  await page.waitForFunction(() => !state.documentSaving);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), 1);
  assert.equal(await page.evaluate(() => projectById('p1').progress), progress);
  await page.evaluate(id => toggleTask(id), taskId);
  assert.equal(await page.evaluate(() => projectById('p1').progress), 100);
  assert.equal(await page.evaluate(() => allWorkbenchTasks()[0].workItems.every(item => item.done)), true);
  assert.equal(await page.evaluate(() => state.chatMessages.filter(message => message.documentId).length), 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].existingTasks.length, 2);
  assert.deepEqual(errors, []);
  await page.evaluate(() => persistWorkbench());
  const result = { passed: true, realIPCAndHTTP: true, initialGroupedTasks: 2,
    reanalysisMergedTasks: 1, originalCompletionPreserved: true, projectProgressUnchangedByMerge: true,
    allPartsCompleteTogether: true, summaryAndDetailNavigation: true };
  writeFileSync(join(evidence, 'analysis-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await application?.close();
  server.closeAllConnections();
  server.close();
}
