import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'workspace-profile-'));
const folder = mkdtempSync(join(evidence, 'workspace-files-'));
mkdirSync(join(folder, '子文件夹'));
writeFileSync(join(folder, '说明.txt'), '工作区文件预览\n第二行');
writeFileSync(join(folder, '子文件夹', 'inside.txt'), 'nested');
writeFileSync(join(folder, 'sample.pdf'), '%PDF-test');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  // Native browsing must work even when a page refuses iframe embedding.
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(`<title>工作区网页 ${req.url}</title><h1>浏览器验收 ${req.url}</h1><a href="/second">下一页</a>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/first`;
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let application;
const errors = [];
try {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile, ZHIXU_TEST_FOLDER: folder }
  });
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.ZHIXU_TEST_FOLDER] });
  });
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('#chat-input').fill('保留这条尚未发送的聊天内容');
  await page.locator('[data-action="workspace-toggle"]').click();
  await page.locator('.workspace-launch[data-tab="files"]').click();
  await page.locator('[data-action="workspace-folder-pick"]').first().click();
  await page.waitForFunction(() => workspaceState.entries.some(item => item.name === '说明.txt'));
  assert.equal(await page.locator('#chat-input').inputValue(), '保留这条尚未发送的聊天内容');
  await page.locator('.workspace-file-row').filter({ hasText: '说明.txt' }).click();
  assert.match(await page.locator('.workspace-file-text').innerText(), /工作区文件预览\n第二行/);
  await page.locator('[data-action="workspace-preview-close"]').click();
  await page.locator('.workspace-file-row').filter({ hasText: '子文件夹' }).click();
  assert.equal(await page.locator('.workspace-file-row').filter({ hasText: 'inside.txt' }).count(), 1);
  await page.locator('[data-action="workspace-folder-up"]').click();
  await page.locator('.workspace-file-row').filter({ hasText: 'sample.pdf' }).click();
  assert.match(await page.locator('.workspace-empty').innerText(), /系统应用/);
  const rejected = await page.evaluate(async () => {
    const results = [];
    for (const path of ['../package.json', 'C:\\Windows\\win.ini']) {
      try { await xiaoyuDesktop.workspace({ operation: 'file-read', rootId: workspaceState.rootId, path }); results.push(false); }
      catch { results.push(true); }
    }
    try { await xiaoyuDesktop.workspace({ operation: 'browser-navigate', url: 'file:///C:/Windows/win.ini' }); results.push(false); }
    catch { results.push(true); }
    return results;
  });
  assert.deepEqual(rejected, [true, true, true]);
  await page.locator('.workspace-tabs [data-tab="terminal"]').click();
  await page.locator('#workspace-command').fill("Write-Output '终端中文验收'; $zhixuProbe = 42");
  await page.locator('[data-action="workspace-terminal-run"]').click();
  await page.waitForFunction(() => !workspaceState.running, null, { timeout: 15000 });
  assert.match(await page.locator('#workspace-terminal-output').innerText(), /终端中文验收/);
  await page.locator('#workspace-command').fill('Write-Output ($zhixuProbe + 1); Set-Location 子文件夹; (Get-Location).Path');
  await page.locator('#workspace-command').press('Enter');
  await page.waitForFunction(() => !workspaceState.running);
  assert.match(await page.locator('#workspace-terminal-output').innerText(), /\n43\r?\n/);
  assert.ok((await page.evaluate(() => workspaceState.cwd)).endsWith('子文件夹'));
  await page.locator('#workspace-command').fill('throw "终端错误验收"');
  await page.locator('#workspace-command').press('Enter');
  await page.waitForFunction(() => !workspaceState.running);
  assert.match(await page.locator('#workspace-terminal-output').innerText(), /退出代码：1/);
  await page.locator('#workspace-command').fill('Start-Sleep -Seconds 120');
  await page.locator('#workspace-command').press('Enter');
  await page.waitForFunction(() => workspaceState.running);
  await page.locator('[data-action="workspace-terminal-stop"]').click();
  await page.waitForFunction(() => !workspaceState.running);
  await page.locator('#workspace-command').fill("Write-Output '停止后重启成功'");
  await page.locator('#workspace-command').press('Enter');
  await page.waitForFunction(() => !workspaceState.running);
  assert.match(await page.locator('#workspace-terminal-output').innerText(), /停止后重启成功/);

  await page.locator('.workspace-tabs [data-tab="browser"]').click();
  await page.locator('#workspace-address').fill(url);
  await page.locator('#workspace-address').press('Enter');
  await page.waitForFunction(() => workspaceState.browser.title === '工作区网页 /first');
  // WebContentsView is not a BrowserWindow; inspect it through the isolated main process.
  const browserInfo = await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    const view = main.contentView.children[0];
    return { visible: view.getVisible(), bounds: view.getBounds(),
      preferences: view.webContents.getLastWebPreferences(),
      url: view.webContents.getURL() };
  });
  assert.equal(browserInfo.visible, true);
  assert.ok(browserInfo.bounds.width > 250 && browserInfo.bounds.height > 200);
  assert.equal(browserInfo.preferences.nodeIntegration, false);
  assert.equal(browserInfo.preferences.sandbox, true);
  const guestAPI = await application.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    return main.contentView.children[0].webContents.executeJavaScript('typeof window.xiaoyuDesktop');
  });
  assert.equal(guestAPI, 'undefined');
  await page.locator('[data-action="chat-attachment"]').click();
  await page.waitForFunction(() => !!document.querySelector('#modal-root > *'));
  await page.waitForTimeout(100);
  assert.equal(await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), false);
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await page.waitForTimeout(100);
  assert.equal(await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), true);
  await page.locator('#workspace-address').fill(url.replace('/first', '/second'));
  await page.locator('#workspace-address').press('Enter');
  await page.waitForFunction(() => workspaceState.browser.canBack && workspaceState.browser.title.endsWith('/second'));
  await page.locator('[data-action="workspace-browser-back"]').click();
  await page.waitForFunction(() => workspaceState.browser.title.endsWith('/first'));
  await page.locator('.workspace-tabs [data-tab="files"]').click();
  await page.waitForTimeout(100);
  assert.equal(await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), false);
  await page.screenshot({ path: join(evidence, 'workspace-files.png') });
  await page.locator('[data-action="workspace-toggle"]').first().click();
  assert.equal(await page.locator('#chat-input').inputValue(), '保留这条尚未发送的聊天内容');
  await page.locator('.nav [data-view="projects"]').click();
  assert.equal(await page.locator('.workspace-panel').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Workspace passed: folder access, preview, traversal rejection, persistent terminal, cancel/restart, isolated browser, history, modal layering and chat draft.');
} finally {
  if (application) await application.close();
  server.close();
}
