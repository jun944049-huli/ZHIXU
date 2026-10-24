import { _electron as electron, chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Document, Packer, Paragraph } from 'docx';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'remote-profile-'));
if (process.env.XIAOYU_REMOTE_CACHE) {
  mkdirSync(join(profile, 'remote'));
  for (const name of ['cloudflared.exe', 'runtime.json']) copyFileSync(join(process.env.XIAOYU_REMOTE_CACHE, name), join(profile, 'remote', name));
}
const password = randomBytes(24).toString('base64url');
const key = 'sk-remote-isolated-test';
let providerCalls = 0;
const provider = createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    assert.equal(request.headers.authorization, `Bearer ${key}`);
    providerCalls++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ model: 'remote-test-model', choices: [{ message: {
      content: JSON.stringify({ reply: '跨设备模型问答已连接。', actions: [] }) } }] }));
  });
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const baseURL = `http://127.0.0.1:${provider.address().port}/v1`;
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let app, browser;
try {
  app = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')], cwd: root,
    env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  const host = await app.firstWindow();
  await host.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await host.evaluate(async ({ key, baseURL }) => {
    DB.projects[0].name = '异地测试项目';
    DB.settings.aiProvider = 'custom';
    DB.settings.customProvider = { name: '隔离供应商', baseUrl: baseURL, apiKey: key, model: 'remote-test-model', protocol: 'chat' };
    saveSettings(); render(); await persistWorkbench();
  }, { key, baseURL });
  console.log('Starting verified HTTPS tunnel with isolated sample data...');
  const remote = await host.evaluate(password => window.xiaoyuDesktop.remoteAccess({ operation: 'start', password }), password,
    { timeout: 300000 });
  assert.match(remote.url, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);
  console.log('HTTPS entry established');
  const browserURL = process.env.XIAOYU_REMOTE_LOCAL === '1' ? remote.localURL : remote.url;
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath: edge, headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const first = await desktop.newPage(), phone = await mobile.newPage();
  for (const page of [first, phone]) {
    for (let attempt = 0; ; attempt++) {
      try { await page.goto(browserURL, { waitUntil: 'domcontentloaded', timeout: 60000 }); break; }
      catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(2500); }
    }
    await page.locator('#login-password').fill(password);
    await page.locator('#login-submit').click();
    await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady, null, { timeout: 60000 });
    await page.evaluate(() => persistWorkbench());
    assert.equal(await page.evaluate(() => window.xiaoyuDesktop.isRemote), true);
    assert.equal(await page.evaluate(key => JSON.stringify(workbenchSnapshot()).includes(key), key), false);
    assert.equal(await page.locator('[data-action="remote-settings"]').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.xiaoyuDesktop.updates), 'undefined');
    await page.evaluate(() => openProfileSettings());
    assert.equal(await page.locator('[data-action="update-settings"]').count(), 0);
    await page.evaluate(() => closeModal());
  }
  console.log('Desktop and mobile browsers logged in over HTTPS');
  await phone.evaluate(async () => { DB.projects[0].goal = '手机保存的共享目标'; render(); await persistWorkbench(); });
  await host.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady && DB.projects[0].goal === '手机保存的共享目标', null, { timeout: 30000 });
  await first.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady && DB.projects[0].goal === '手机保存的共享目标', null, { timeout: 30000 });
  await host.evaluate(async () => { DB.projects[0].goal = '桌面保存的共享目标'; render(); await persistWorkbench(); });
  await phone.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady && DB.projects[0].goal === '桌面保存的共享目标', null, { timeout: 30000 });
  await first.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady && DB.projects[0].goal === '桌面保存的共享目标', null, { timeout: 30000 });
  console.log('Phone, desktop browser and host shared updates in both directions');
  await phone.evaluate(() => { state.view = 'chat'; render(); });
  await phone.locator('#chat-input').fill('请验证异地模型对话');
  await phone.locator('[data-action="chat-send"]').click();
  await phone.waitForFunction(() => !state.chatSending, null, { timeout: 80000 });
  assert.match(await phone.locator('#view').innerText(), /跨设备模型问答已连接/);
  assert.ok(providerCalls > 0);
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('异地测试项目'), new Paragraph('完成浏览器验收并记录结果。')
  ] }] }));
  await phone.evaluate(() => openDocumentImport('chat'));
  await phone.locator('#text-file').setInputFiles({ name: '异地验收.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: bytes });
  await phone.locator('#import-project').selectOption('p1');
  await phone.locator('#document-engine').selectOption('local');
  await phone.locator('[data-action="document-import"]').click();
  await phone.waitForFunction(() => !state.documentImportBusy && DB.documents.some(doc => doc.title === '异地验收.docx'), null, { timeout: 90000 });
  const documentId = await phone.evaluate(() => DB.documents.find(doc => doc.title === '异地验收.docx').id);
  const downloadEvent = phone.waitForEvent('download');
  await phone.evaluate(id => window.xiaoyuDesktop.exportOriginal({ name: '异地验收.docx', assetId: DB.documents.find(doc => doc.id === id).assetId }), documentId);
  const download = await downloadEvent;
  await download.saveAs(join(evidence, 'remote-original.docx'));
  for (const view of ['today', 'chat', 'inbox', 'projects', 'reports', 'profile', 'data']) {
    await phone.evaluate(view => { state.view = view; render(); }, view);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, view + ' horizontal overflow');
  }
  await phone.evaluate(() => { state.view = 'projects'; render(); });
  await phone.evaluate(() => document.getAnimations().forEach(animation => {
    if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
  }));
  await phone.screenshot({ path: join(evidence, 'remote-mobile.png'), fullPage: true });
  await first.waitForFunction(id => typeof workbenchReady !== 'undefined' && workbenchReady &&
    DB.documents?.some(doc => doc.id === id), documentId, { timeout: 30000 });
  await first.evaluate(() => persistWorkbench());
  await phone.evaluate(() => persistWorkbench());
  assert.equal(await phone.evaluate(async () => (await window.xiaoyuDesktop.revision()).changed), false,
    'Opening the imported document on another device must not create a new workbench revision');
  await first.evaluate(() => { state.view = 'chat'; render(); document.getElementById('chat-input').focus(); });
  await phone.evaluate(async () => { DB.projects[0].goal = '手机后续更新'; render(); await persistWorkbench(); });
  const conflict = await first.evaluate(async () => {
    DB.projects[0].goal = '旧网页不能覆盖';
    try { await persistWorkbench(); return ''; } catch (error) { return error.message; }
  });
  assert.match(conflict, /其他设备已更新/);
  assert.equal(await host.evaluate(async () => (await window.xiaoyuDesktop.load()).db.projects[0].goal), '手机后续更新');
  await first.screenshot({ path: join(evidence, 'remote-conflict.png') });
  await phone.locator('[data-action="web-logout"]').click();
  await phone.waitForURL('**/login', { timeout: 15000 });
  await host.evaluate(() => window.xiaoyuDesktop.remoteAccess({ operation: 'stop' }));
  writeFileSync(join(evidence, 'remote-result.json'), JSON.stringify({
    passed: true, profile, providerCalls, sharedData: true, originalDownload: true, conflictProtected: true,
    externalHTTPS: browserURL === remote.url
  }, null, 2));
  console.log(`Remote browser flow passed (${browserURL === remote.url ? 'public HTTPS' : 'loopback HTTP'}): login, shared desktop/mobile data, model Q&A, DOCX upload, original download, 7 mobile pages, conflict protection, logout.`);
} catch (error) {
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    console.log('Browser sync diagnostics:', await page.evaluate(async () => ({
      visibility: document.visibilityState, activeElement: document.activeElement?.tagName,
      sameSnapshot: typeof workbenchLastSaved !== 'undefined' && JSON.stringify(workbenchSnapshot()) === workbenchLastSaved,
      changed: await window.xiaoyuDesktop?.revision(),
      notice: document.getElementById('workbench-sync-notice')?.textContent,
      goal: typeof DB !== 'undefined' && DB.projects[0].goal,
      modal: !!document.querySelector('#modal-root .modal')
    })).catch(() => null));
  }
  console.log('Host sync diagnostics:', await app?.firstWindow().then(page => page.evaluate(async () => ({
    visibility: document.visibilityState, activeElement: document.activeElement?.tagName,
    sameSnapshot: JSON.stringify(workbenchSnapshot()) === workbenchLastSaved,
    changed: await window.xiaoyuDesktop.revision(),
    notice: document.getElementById('workbench-sync-notice')?.textContent,
    goal: DB.projects[0].goal,
    busy: { chat: state.chatSending, document: state.documentImportBusy, timer: !!DB.runningTimer },
    modal: !!document.querySelector('#modal-root .modal')
  }))).catch(() => null));
  throw error;
} finally {
  if (app) {
    await app.close().catch(() => {});
  }
  await browser?.close();
  await new Promise(done => provider.close(done));
}
