import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const application = await electron.launch({
  executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
  args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
  env: { ...env, XIAOYU_DATA_DIR: mkdtempSync(join(evidence, 'overdue-profile-')) }
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await ready();
  await page.evaluate(() => {
    DB.tasks = { must: [], should: [], could: [] }; DB.taskCalendar = {}; DB.overdue = [];
    for (const id of ['qa-a', 'qa-b']) addConfirmedTask({
      id, title: '同名清单', project: id === 'qa-a' ? 'p1' : 'p2',
      estimate: '1h', priority: 'P2', due: addDaysISO(DB.meta.today, -2), overdue: true
    }, DB.meta.today, 'should');
    render();
  });
  assert.match(await page.locator('.overdue-strip .title').innerText(), /2 项/);
  await page.locator('[data-action="overdue"]').click();
  assert.equal(await page.locator('#modal-root [data-action="task-edit"]').count(), 2);
  await page.locator('#modal-root [data-action="task-edit"][data-id="qa-a"]').click();
  await page.locator('#task-title').fill('补充后的验收清单');
  await page.locator('#task-note').fill('已更新清单，仍保留原截止日期');
  await page.locator('[data-action="task-save"]').click();
  await page.waitForFunction(() => (document.querySelector('#modal-root')?.innerText || '').includes('补充后的验收清单'));
  assert.equal(await page.locator('#modal-root .modal').count(), 1, 'editing from the overdue list stays in the list');
  assert.match(await page.locator('.overdue-strip').innerText(), /补充后的验收清单/);
  await page.locator('#modal-root [data-action="task-edit"][data-id="qa-a"]').click();
  const future = await page.evaluate(() => addDaysISO(DB.meta.today, 3));
  await page.locator('#task-date').fill(future);
  await page.locator('[data-action="task-save"]').click();
  assert.match(await page.locator('.overdue-strip .title').innerText(), /1 项/);
  await page.evaluate(() => persistWorkbench());
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => taskLocation('qa-a').date), future);
  assert.equal(await page.evaluate(() => overdueTasks()[0].id), 'qa-b');
  await page.locator('[data-action="overdue"]').click();
  await page.locator('[data-action="overdue-plan"][data-id="qa-b"]').click();
  assert.equal(await page.locator('.overdue-strip').count(), 0);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), 2);
  await page.evaluate(() => {
    for (const task of allWorkbenchTasks()) task.due = addDaysISO(DB.meta.today, -1);
    render();
  });
  await page.locator('[data-task="qa-b"] [data-action="check"]').click();
  assert.equal(await page.evaluate(() => overdueTasks().length), 1);
  assert.equal(await page.evaluate(() => overdueTasks()[0].id), 'qa-a');
  await page.evaluate(() => persistWorkbench());
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => overdueTasks().length), 1);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), 2);

  // arranging one overdue task keeps the list open for the remaining items
  await page.evaluate(() => {
    for (const [id, title] of [['keep-a', '保留 A'], ['keep-b', '保留 B']])
      addConfirmedTask({ id, title, project: null, estimate: '1h', priority: 'P2',
        due: addDaysISO(DB.meta.today, -1), overdue: true }, DB.meta.today, 'should');
    render();
  });
  await page.locator('[data-action="overdue"]').click();
  assert.equal(await page.locator('#modal-root [data-action="overdue-plan"]').count(), 3);
  await page.locator('[data-action="overdue-plan"][data-id="keep-a"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#modal-root [data-action="overdue-plan"]').length === 2);
  assert.equal(await page.locator('#modal-root .modal').count(), 1);
  assert.match(await page.locator('#modal-root').innerText(), /保留 B/);
  assert.doesNotMatch(await page.locator('#modal-root').innerText(), /保留 A/);
  await page.locator('#modal-root [data-action="close-modal"]').click();

  // waiting items can be deleted from the open list and remain in the local archive
  await page.evaluate(() => {
    DB.waiting = [{ id: 'w-1', title: '等待设计确认', person: '小陈', days: 1, impact: '影响评审', status: 'open' },
      { id: 'w-2', title: '等待盖章', person: '行政', days: 2, impact: '影响提交', status: 'open' }];
    render();
  });
  await page.locator('[data-action="waiting"]').click();
  assert.equal(await page.locator('#modal-root [data-action="waiting-remove"]').count(), 2);
  await page.locator('[data-action="waiting-remove"][data-id="w-1"]').click();
  await page.locator('[data-action="waiting-remove-confirm"]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#modal-root')?.innerText || '';
    return text.includes('等待盖章') && !text.includes('等待设计确认');
  });
  assert.equal(await page.evaluate(() => DB.waiting.length), 1);
  assert.equal(await page.evaluate(() => DB.recordArchive.at(-1).record.id), 'w-1');
  assert.equal(await page.locator('#modal-root .modal').count(), 1);
  await page.locator('#modal-root [data-action="close-modal"]').click();

  // attachment records can be deleted from the library and remain in the local archive
  await page.evaluate(() => {
    DB.documents.push({ id: 'doc-delete', title: '待删除附件.docx', content: '待删除', projectId: null,
      analysis: { mode: '本地规则', tasks: [] } });
    openDocumentLibrary();
  });
  await page.locator('[data-action="document-remove"][data-id="doc-delete"]').click();
  await page.locator('[data-action="document-remove-confirm"]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#modal-root')?.innerText || '';
    return text.includes('附件记录与待确认项目') && !text.includes('待删除附件');
  });
  assert.equal(await page.evaluate(() => DB.documents.some(doc => doc.id === 'doc-delete')), false);
  assert.equal(await page.evaluate(() => DB.documentArchive.at(-1).id), 'doc-delete');
  assert.equal(await page.locator('#modal-root .modal').count(), 1);
  await page.locator('#modal-root [data-action="close-modal"]').click();

  assert.deepEqual(errors, []);
  console.log('Overdue UI passed: edit, reschedule, restart, same-title isolation, completion isolation.');
} finally { await application.close(); }
