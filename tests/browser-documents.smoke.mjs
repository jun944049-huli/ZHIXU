import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const files = mkdtempSync(join(evidence, 'browser-document-fixtures-'));
execFileSync(process.execPath, ['--import', 'tsx', 'tests/document-fixtures.ts', '--write', files, '--large'], { cwd: root });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const close = () => page.locator('#modal-root [data-action="close-modal"]').first().click();
async function upload(names) {
  await page.locator('[data-action="workspace-upload"]').click();
  await page.locator('#text-file').setInputFiles(names.map(name => join(files, name)));
  await page.locator('#document-engine').selectOption('local');
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy, null, { timeout: 240000 });
}
try {
  await page.goto(process.env.XIAOYU_BROWSER_URL || 'http://127.0.0.1:5174/');
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="workspace-toggle"]').click();
  await page.locator('.workspace-tabs [data-tab="files"]').click();
  await upload(['附件需求.docx', '附件清单.xlsx', '附件演示.pptx', '附件任务.pdf']);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 4);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => doc.projectId === 'p1').length), 3);
  const id = await page.evaluate(() => DB.documents.find(doc => doc.title.endsWith('.docx')).id);
  await page.locator(`#modal-root [data-action="document-open"][data-id="${id}"]`).click();
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="document-original"]').click();
  const download = await downloading;
  assert.deepEqual(readFileSync(await download.path()), readFileSync(join(files, '附件需求.docx')));
  await close();
  await upload(['坏文件.pdf']);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files[0].name), '坏文件.pdf');
  assert.match(await page.locator('#document-import-results').innerText(), /不匹配/);
  assert.equal(await page.locator('#text-file').isEnabled(), true);
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => doc.title === '坏文件.pdf').length), 1);
  await close();
  await upload(['超过50MB.pdf']);
  assert.match(await page.locator('#document-import-results').innerText(), /50 MB/);
  assert.equal(await page.locator('#text-file').evaluate(input => input.files.length), 1);
  await close();
  await upload(['大附件49MB.pdf']);
  assert.equal(await page.evaluate(() => DB.documents.find(doc => doc.title === '大附件49MB.pdf').parseError), '');
  assert.match(await page.evaluate(() => DB.documents.find(doc => doc.title === '大附件49MB.pdf').content), /large document review/);
  await close();
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.evaluate(() => DB.documents.filter(doc => !doc.parseError).length), 5);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, formats: ['DOCX', 'XLSX', 'PDF', 'PPTX'],
    largeFile: '49 MB', overLimitRetained: true, parseErrorRetained: true, originalExportVerified: true }));
} finally { await browser.close(); }
