import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'document-profile-'));
const files = mkdtempSync(join(evidence, 'document-fixtures-'));
const exports = mkdtempSync(join(evidence, 'document-exports-'));
execFileSync(process.execPath, ['--import', 'tsx', 'tests/document-fixtures.ts', '--write', files, '--large'], { cwd: root });
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
const errors = [];
let application, page;
async function launch() {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile, XIAOYU_EXPORT_DIR: exports }
  });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async (_owner, options) => ({ canceled: false,
      filePath: process.env.XIAOYU_EXPORT_DIR + '/' + options.defaultPath });
  });
}
const close = () => page.locator('#modal-root [data-action="close-modal"]').first().click();
async function upload(names, project = '', instructions = '提取交付物；不要推测日期和负责人。') {
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles(names.map(name => join(files, name)));
  await page.locator('#import-project').selectOption(project);
  await page.locator('#document-instructions').fill(instructions);
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy, null, { timeout: 210000 });
}

try {
  await launch();
  const initialTasks = await page.evaluate(() => allWorkbenchTasks().length);
  const initialProjects = await page.evaluate(() => DB.projects.length);
  await upload(['附件需求.docx', '附件清单.xlsx', '附件演示.pptx', '附件任务.pdf']);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 4);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => doc.projectId === 'p1').length), 3);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 6);
  assert.equal(await page.evaluate(() => DB.projects.length), initialProjects);
  const wordId = await page.evaluate(() => DB.documents.find(doc => doc.title.endsWith('.docx')).id);
  await page.locator(`[data-action="document-open"][data-id="${wordId}"]`).click();
  await page.locator('.document-source summary').click();
  assert.match(await page.locator('.document-content').innerText(), /完成附件需求梳理/);
  await page.locator('#draft-title-0').fill('修改后的附件验收任务');
  await page.locator('#document-project').selectOption('p2');
  await page.locator('[data-action="document-apply"]').click();
  await page.waitForFunction(id => documentById(id).projectId === 'p2', wordId);
  await page.locator('[data-action="document-save"]').click();
  await page.waitForFunction(() => !state.documentSaving);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 6);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().find(task => task.title === '修改后的附件验收任务').project), 'p2');
  await page.locator('[data-action="document-reanalyze"]').click();
  assert.match(await page.locator('#modal-root').innerText(), /已有任务会保留/);
  await page.locator('[data-action="document-reanalyze-confirm"]').click();
  await page.locator('.document-editor').waitFor();
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 6);
  await page.locator('[data-action="document-original"]').click();
  await page.waitForFunction(() => document.querySelector('#toast-root').textContent.includes('原文件已导出'));
  assert.deepEqual(readFileSync(join(exports, '附件需求.docx')), readFileSync(join(files, '附件需求.docx')));
  await close();
  await upload(['坏文件.pdf']);
  assert.match(await page.locator('#modal-root').innerText(), /无法解析/);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files[0].name), '坏文件.pdf');
  assert.equal(await page.locator('#text-file').isEnabled(), true);
  assert.match(await page.locator('[data-action="document-import"]').innerText(), /重试失败文件/);
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files.length), 1);
  assert.match(await page.locator('#document-import-results').innerText(), /扩展名与文件内容不匹配/);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 4);
  const failedId = await page.evaluate(() => DB.documents.find(doc => doc.title === '坏文件.pdf').id);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => doc.parseError).length), 1);
  await page.locator(`[data-action="document-open"][data-id="${failedId}"]`).click();
  await page.locator('[data-action="document-original"]').click();
  await page.waitForFunction(() => document.querySelector('#toast-root').textContent.includes('原文件已导出'));
  assert.deepEqual(readFileSync(join(exports, '坏文件.pdf')), readFileSync(join(files, '坏文件.pdf')));
  await page.locator('[data-action="document-reparse"]').click();
  await page.waitForFunction(() => !state.documentReparsing);
  assert.match(await page.locator('.document-editor').innerText(), /正文解析失败/);
  await close();
  await upload(['坏文件.pdf', '附件需求.docx']);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files.length), 2);
  assert.equal(await page.locator('.document-import-result.saved').count(), 1);
  assert.equal(await page.locator('.document-import-result.failed').count(), 1);
  const tasksBeforeRetry = await page.evaluate(() => allWorkbenchTasks().length);
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 4);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), tasksBeforeRetry);
  await page.locator('#text-file').setInputFiles([]);
  assert.equal(await page.locator('.document-import-result').count(), 0);
  await close();
  await upload(['新项目资料.md']);
  assert.equal(await page.evaluate(() => DB.projects.length), initialProjects);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 6);
  const freshId = await page.evaluate(() => DB.documents.find(doc => doc.title === '新项目资料.md').id);
  await page.locator('#document-project').selectOption('new');
  await page.locator('#document-project-name').fill('远山巡检验收');
  await page.locator('#document-summary').fill('设备清单和验收材料，均等待确认后归档。');
  await page.locator('#draft-title-0').fill('确认后的设备清单');
  await page.locator('[data-action="document-save"]').click();
  await page.waitForFunction(() => !state.documentSaving);
  assert.equal(await page.evaluate(() => DB.projects.length), initialProjects);
  await close();
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="document-library"]').click();
  await page.locator(`[data-action="document-open"][data-id="${freshId}"]`).click();
  assert.equal(await page.locator('#document-project').inputValue(), 'new');
  assert.equal(await page.locator('#document-project-name').inputValue(), '远山巡检验收');
  await page.locator('[data-action="document-apply"]').click();
  await page.waitForFunction(() => DB.projects.some(project => project.name === '远山巡检验收'));
  assert.equal(await page.evaluate(() => DB.projects.length), initialProjects + 1);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 8);
  await page.locator('#draft-title-0').fill('保存修改后的设备清单');
  await page.locator('[data-action="document-save"]').click();
  await page.waitForFunction(() => !state.documentSaving);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().some(task => task.title === '保存修改后的设备清单')), true);
  await page.locator('[data-action="document-apply"]').click();
  await page.waitForFunction(() => !state.documentSaving);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 8);
  await close();
  await upload(['新项目资料.md']);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 5);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 8);
  await close();
  await application.close();
  await launch();
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 5);
  assert.equal(await page.evaluate(() => allWorkbenchTasks().length), initialTasks + 8);
  assert.equal(await page.evaluate(() => DB.projects.length), initialProjects + 1);
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="document-library"]').click();
  await page.locator(`[data-action="document-open"][data-id="${wordId}"]`).click();
  await page.locator('[data-action="document-original"]').click();
  await page.waitForFunction(() => document.querySelector('#toast-root').textContent.includes('原文件已导出'));
  assert.deepEqual(readFileSync(join(exports, '附件需求.docx')), readFileSync(join(files, '附件需求.docx')));
  await close();
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles({ name: '临时保存故障.md', mimeType: 'text/markdown',
    buffer: Buffer.from('完成临时保存故障的附件核对') });
  await page.evaluate(() => {
    const originalSave = persistWorkbench;
    persistWorkbench = async () => {
      persistWorkbench = originalSave;
      throw new Error('模拟临时磁盘写入失败');
    };
  });
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.match(await page.locator('#document-import-results').innerText(), /本地记录保存失败.*模拟临时磁盘写入失败/);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files[0].name), '临时保存故障.md');
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 5);
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  await page.locator('.document-editor').waitFor();
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 6);
  await close();
  await upload(['大附件49MB.pdf']);
  assert.match(await page.locator('.document-content').textContent(), /Prepare the large document review/);
  await page.locator('[data-action="document-original"]').click();
  await page.waitForFunction(() => document.querySelector('#toast-root').textContent.includes('原文件已导出'));
  assert.deepEqual(readFileSync(join(exports, '大附件49MB.pdf')), readFileSync(join(files, '大附件49MB.pdf')));
  await close();
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles(join(files, '超过50MB.pdf'));
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.match(await page.locator('#document-import-results').innerText(), /超过 50 MB/);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files.length), 1);
  assert.equal(await page.evaluate(() => DB.documents.length), 8);
  assert.deepEqual(errors, []);
  const result = { passed: true, formats: ['DOCX', 'XLSX', 'PDF', 'PPTX', 'Markdown'],
    documents: 8, parsedDocuments: 7, largePDFBytes: readFileSync(join(files, '大附件49MB.pdf')).length,
    sourcePreservedOnParseFailure: true, reparseAvailable: true, over50MBRejectedAndSelectionRetained: true,
    newProjectsAfterConfirmation: 1, createdTasks: 8,
    failedSelectionRetained: true, partialBatchIdempotent: true, transientFailureRetried: true,
    exported: readdirSync(exports), profile };
  writeFileSync(join(evidence, 'document-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => 'Window unavailable'));
  throw error;
} finally { await application?.close(); }
