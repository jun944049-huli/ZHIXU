import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'updates-profile-'));
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let application;
let feed;
try {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  let page = await application.firstWindow();
  const displayVersion = await application.evaluate(({ app }) => app.getVersion());
  if (process.env.XIAOYU_TEST_EXE) assert.equal(displayVersion, version);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.evaluate(() => openProfileSettings());
  await page.locator('[data-action="update-settings"]').click();
  await page.locator('#update-current-version').waitFor();
  await page.waitForFunction(version => document.getElementById('update-current-version').textContent.includes(version), displayVersion);
  assert.equal(await page.locator('#update-automatic').isChecked(), true);
  assert.equal(await page.locator('[data-action="update-install"]').isVisible(), false);
  await page.locator('#update-automatic').uncheck();
  await page.locator('[data-action="update-save"]').click();
  await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('设置已保存'));
  assert.equal(JSON.parse(readFileSync(join(profile, 'updates.json'), 'utf8')).automatic, false);
  const fakeCredential = 'isolated-fake-update-token';
  const configured = await page.evaluate(token => window.xiaoyuDesktop.updates({
    operation: 'configure', automatic: false, token
  }), fakeCredential);
  assert.equal(configured.hasToken, true);
  assert.equal(readFileSync(join(profile, 'updates.json'), 'utf8').includes(fakeCredential), false);
  assert.equal(JSON.stringify(configured).includes(fakeCredential), false);
  await page.evaluate(() => window.xiaoyuDesktop.updates({ operation: 'configure', automatic: false, clearToken: true }));
  await page.evaluate(() => closeModal());
  await page.evaluate(async () => {
    state.view = 'chat'; render();
    document.getElementById('chat-input').value = '未发送的草稿';
  });
  assert.equal(await page.evaluate(() => prepareWorkbenchUpdate()), false);
  await page.evaluate(() => { document.getElementById('chat-input').value = ''; });
  assert.equal(await page.evaluate(() => prepareWorkbenchUpdate()), true);
  await page.evaluate(() => {
    openDesktopUpdates();
  });
  await page.waitForFunction(version => document.getElementById('update-current-version').textContent.includes(version), displayVersion);
  await page.evaluate(() => paintDesktopUpdate({
    ...desktopUpdateStatus, stage: 'downloading', percent: 42, message: '正在后台下载，可继续工作。'
  }));
  assert.equal(await page.locator('#update-progress').isVisible(), true);
  assert.equal(await page.locator('[data-action="update-check"]').isDisabled(), true);
  await page.evaluate(() => paintDesktopUpdate({
    ...desktopUpdateStatus, stage: 'ready', version: '0.3.0', percent: 100, message: '新版本已下载，重启即可更新。'
  }));
  assert.equal(await page.locator('[data-action="update-install"]').isVisible(), true);
  assert.equal(await page.locator('#desktop-update-notice').isVisible(), true);
  await page.evaluate(() => document.getAnimations().forEach(animation => {
    if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
  }));
  await page.waitForFunction(() => [...document.querySelectorAll('.update-modal,.modal-backdrop')]
    .every(element => getComputedStyle(element).opacity === '1'));
  await page.screenshot({ path: join(evidence, 'updates-desktop.png'), timeout: 15000 });
  await page.evaluate(() => paintDesktopUpdate({ ...desktopUpdateStatus, stage: 'idle', version: '' }));
  assert.equal(await page.locator('#desktop-update-notice').count(), 0);

  const fixture = Buffer.from('isolated update download fixture, never executed');
  let corrupt = false;
  let stalled = false;
  const sha512 = createHash('sha512').update(fixture).digest('base64');
  feed = createServer((request, response) => {
    if (request.url.startsWith('/latest.yml')) response.end(
      `version: 0.3.0\nfiles:\n  - url: test.exe\n    sha512: ${corrupt ? Buffer.alloc(64).toString('base64') : sha512}\n    size: ${fixture.length}\n`);
    else if (stalled) response.write(fixture.subarray(0, 3));
    else response.end(fixture);
  });
  feed.listen(0, '127.0.0.1'); await once(feed, 'listening');
  const engineDownload = async (cacheName) => application.evaluate(async ({ app }, { root, profile, url, cacheName }) => {
    const require = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
    const { join } = require('node:path');
    const { writeFileSync } = require('node:fs');
    const { NsisUpdater } = require('electron-updater');
    const { UpdateHttpExecutor } = require(root + '/out/main/update-http.js');
    const trace = value => writeFileSync(join(profile, cacheName + '.events'), Date.now() + ' ' + value + '\n', { flag: 'a' });
    class FixtureExecutor extends UpdateHttpExecutor {
      createRequest(options, callback) {
        trace('request');
        const request = super.createRequest(options, response => {
          trace('response');
          response.on('end', () => trace('response end'));
          callback(response);
        });
        for (const event of ['close', 'abort', 'error']) request.on(event, () => trace(event));
        return request;
      }
      addErrorAndTimeoutHandlers(request, reject) {
        trace('timeout armed');
        super.addErrorAndTimeoutHandlers(request, error => { trace('reject ' + error.message); reject(error); });
      }
    }
    const config = join(profile, cacheName + '.yml');
    writeFileSync(config, `updaterCacheDirName: ${cacheName}\n`);
    const adapter = {
      version: '0.2.9', name: 'isolated-updater-test', isPackaged: true,
      appUpdateConfigPath: config, userDataPath: profile, baseCachePath: profile,
      whenReady: () => app.whenReady(), quit: () => { throw new Error('Test must not install'); },
      relaunch: () => { throw new Error('Test must not restart'); }, onQuit: () => {}
    };
    const engine = new NsisUpdater(null, adapter);
    engine.logger = null; engine.httpExecutor = new FixtureExecutor(500);
    engine.autoDownload = false; engine.autoInstallOnAppQuit = false;
    engine.disableWebInstaller = true; engine.disableDifferentialDownload = true;
    engine.setFeedURL({ provider: 'generic', url });
    let downloaded = false;
    engine.on('error', () => {});
    engine.on('update-downloaded', () => { downloaded = true; });
    try {
      await engine.checkForUpdates(); trace('checked'); await engine.downloadUpdate(); trace('downloaded');
      return { downloaded, checksumRejected: false, timedOut: false };
    } catch (error) {
      return { downloaded, checksumRejected: /sha512|checksum|digest/i.test(String(error)), timedOut: /ETIMEDOUT/.test(String(error)) };
    }
  }, { root, profile, url: `http://127.0.0.1:${feed.address().port}`, cacheName });
  assert.deepEqual(await engineDownload('valid-update-fixture'), { downloaded: true, checksumRejected: false, timedOut: false });
  console.log('Valid installer bytes verified');
  corrupt = true;
  assert.deepEqual(await engineDownload('corrupt-update-fixture'), { downloaded: false, checksumRejected: true, timedOut: false });
  console.log('Corrupt installer rejected');
  corrupt = false; stalled = true;
  const timeoutResult = await engineDownload('stalled-update-fixture');
  console.log('Stalled transfer result:', JSON.stringify(timeoutResult));
  assert.deepEqual(timeoutResult, { downloaded: false, checksumRejected: false, timedOut: true });
  stalled = false;
  assert.deepEqual(await engineDownload('retry-update-fixture'), { downloaded: true, checksumRejected: false, timedOut: false });
  console.log('Real updater verified valid bytes, corrupt checksums, stalled downloads and retry without installing');

  if (process.env.XIAOYU_TEST_UPDATES_LIVE === '1') {
    console.log('Verifying the published private release and a real SHA-512 checked download...');
    const result = await application.evaluate(async ({ app }, { root, profile }) => {
      const require = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
      const { execFile } = require('node:child_process');
      const { writeFileSync, readFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { createHash } = require('node:crypto');
      const token = await new Promise(resolve => {
        const child = execFile('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
          windowsHide: true, timeout: 10000,
          env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' }
        }, (error, stdout) => resolve(error ? '' : stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9).trim()));
        child.stdin.end('protocol=https\nhost=github.com\nusername=jun944049-huli\n\n');
      });
      if (!token) throw new Error('Private release verification requires an existing authorized Git login');
      const { NsisUpdater } = require('electron-updater');
      const { configureUpdateTransport } = require(root + '/out/main/update-http.js');
      const { CancellationToken } = require('builder-util-runtime');
      const config = join(profile, 'app-update.yml');
      writeFileSync(config, 'updaterCacheDirName: isolated-update-cache\n');
      const adapter = {
        version: '0.2.8', name: 'isolated-updater-test', isPackaged: true,
        appUpdateConfigPath: config, userDataPath: profile, baseCachePath: profile,
        whenReady: () => app.whenReady(), quit: () => { throw new Error('Test must not install'); },
        relaunch: () => { throw new Error('Test must not restart'); }, onQuit: () => {}
      };
      const updater = new NsisUpdater(null, adapter);
      updater.logger = null;
      await configureUpdateTransport(updater);
      updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
      updater.disableDifferentialDownload = true; updater.disableWebInstaller = true;
      updater.setFeedURL({ provider: 'github', owner: 'jun944049-huli', repo: 'HULIKU', private: true, token });
      const observed = [];
      updater.on('error', () => observed.push('error'));
      updater.on('update-available', () => observed.push('available'));
      updater.on('update-downloaded', () => observed.push('downloaded'));
      const cancellation = new CancellationToken();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const latest = await updater.checkForUpdates();
            const files = await updater.downloadUpdate(cancellation);
            const bytes = readFileSync(files[0]);
            return { version: latest.updateInfo.version, bytes: bytes.length,
              sha512: createHash('sha512').update(bytes).digest('base64'), observed };
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => {
            cancellation.cancel(); reject(new Error('Verification timed out'));
          }, 180000); })
        ]);
      } catch { throw new Error('Private release check/download verification failed'); }
      finally { clearTimeout(timer); }
    }, { root, profile });
    const metadata = readFileSync(join(root, 'release/latest.yml'), 'utf8');
    const expected = metadata.match(/sha512: ([^\r\n]+)/)[1];
    assert.equal(result.version, version);
    assert.equal(result.sha512, expected);
    assert.ok(result.bytes > 100000000);
    assert.deepEqual(result.observed, ['available', 'downloaded']);
    const status = await page.evaluate(() => window.xiaoyuDesktop.updates({ operation: 'check' }));
    assert.equal(status.stage, 'idle');
    assert.match(status.message, /最新版本/);
    console.log(JSON.stringify({ privateRelease: true, downloadVerified: true, bytes: result.bytes }));
  }
  await page.evaluate(() => persistWorkbench());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, profile, ui: true }));
  writeFileSync(join(evidence, 'updates-result.json'), JSON.stringify({
    passed: true, profile, live: process.env.XIAOYU_TEST_UPDATES_LIVE === '1'
  }, null, 2));
} finally {
  feed?.closeAllConnections(); feed?.close();
  await application?.close().catch(() => {});
}
