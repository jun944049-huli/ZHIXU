import { chromium, _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';

const evidence = resolve('.desktop-test');
mkdirSync(evidence, { recursive: true });
let application, browser, page;
const errors = [];
const desktop = !!process.env.XIAOYU_TEST_EXE;
const close = () => page.locator('#modal-root [data-action="close-modal"]').first().click();
const ready = () => page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
const badge = view => page.locator(`.nav [data-view="${view}"] .nav-badge`);
try {
  if (desktop) {
    const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
    application = await electron.launch({ executablePath: process.env.XIAOYU_TEST_EXE,
      env: { ...env, XIAOYU_DATA_DIR: mkdtempSync(join(evidence, 'personalization-profile-')) } });
    page = await application.firstWindow();
  } else {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    await page.goto(process.env.XIAOYU_BROWSER_URL || 'http://127.0.0.1:5174/');
  }
  page.on('pageerror', error => errors.push(error.message));
  await ready();
  assert.equal(await page.locator('.sidebar [data-action="profile-settings"]').count(), 1);
  assert.equal(await page.locator('.sidebar .user-chip').count(), 0);
  const originalColor = await page.evaluate(() => DB.user.color);
  await page.locator('.workspace-switch').click();
  await page.locator('[data-action="avatar-color"][data-color="#1F8A70"]').click();
  await page.locator('[data-action="save-profile"]').click();
  assert.equal(await page.locator('.workspace-avatar').evaluate(el => el.style.background), 'rgb(31, 138, 112)');
  await page.locator('.workspace-switch').click();
  await page.locator('[data-action="avatar-color"][data-color="#C07A2B"]').click();
  await close();
  assert.equal(await page.evaluate(() => DB.user.color), '#1F8A70');
  await page.locator('.workspace-switch').click();
  await page.locator('#profile-photo').setInputFiles(resolve('prototype/brand/zhixu.png'));
  await page.waitForFunction(() => !!state.profileDraft.avatarImage && !state.profileDraft.photoBusy);
  assert.equal(await page.locator('#profile-avatar img').count(), 1);
  await page.locator('[data-action="save-profile"]').click();
  assert.equal(await page.locator('.workspace-avatar img').count(), 1);
  await page.evaluate(() => persistWorkbench());
  await page.reload(); await ready();
  assert.equal(await page.locator('.workspace-avatar img').evaluate(img => img.complete && img.naturalWidth === 192), true);
  await page.locator('.workspace-switch').click();
  await page.locator('#profile-photo').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await page.waitForFunction(() => document.querySelector('#profile-photo-status').textContent.includes('失败'));
  assert.equal(await page.locator('#profile-avatar img').count(), 1);
  await close();

  const count = await page.evaluate(() => DB.inbox.length);
  await page.locator('.nav [data-view="inbox"]').click();
  await page.locator('#view [data-action="inbox-delete"]').first().click();
  await page.locator('[data-action="inbox-delete-confirm"]').click();
  await page.waitForFunction(n => DB.inbox.length === n - 1, count);
  assert.equal(await badge('inbox').innerText(), String(count - 1));
  await page.locator('[data-action="inbox-archive"]').click();
  await page.locator('[data-action="inbox-restore"]').first().click();
  await page.waitForFunction(n => DB.inbox.length === n, count);
  assert.equal(await badge('inbox').innerText(), String(count));
  await page.evaluate(() => persistWorkbench());
  await page.reload(); await ready();
  assert.equal(await badge('inbox').innerText(), String(count));

  await page.evaluate(() => {
    const sample = { ...allWorkbenchTasks()[0], done: false };
    DB.tasks = { must: [{ ...sample, id: 'badge-a' }], should: [{ ...sample, id: 'badge-b' }],
      could: [{ ...sample, id: 'badge-c' }] };
    state.view = 'today'; state.todayDate = DB.meta.today; render();
  });
  assert.equal(await badge('today').innerText(), '3');
  await page.locator('[data-task="badge-a"] [data-action="check"]').click();
  assert.equal(await badge('today').innerText(), '2');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 496, height: 604 }, { width: 390, height: 844 }]) {
    if (desktop) await application.browserWindow(page).then(window => window.evaluate((w, size) => w.setSize(size.width, size.height), viewport));
    else await page.setViewportSize(viewport);
    for (const view of ['inbox', 'today', 'projects']) {
      assert.equal(await badge(view).isVisible(), true);
      const bounds = await badge(view).boundingBox();
      assert.ok(bounds.x >= 0 && bounds.width >= 18 && bounds.height >= 18);
      assert.match(await page.locator(`.nav [data-view="${view}"]`).getAttribute('title'), /\d/);
    }
    assert.equal(await page.getByRole('button', { name: '收件箱', exact: true }).count(), 1);
    await page.screenshot({ path: join(evidence, `sidebar-${desktop ? 'desktop' : 'web'}-${viewport.width}.png`) });
  }
  await page.evaluate(() => { DB.inbox = Array.from({ length: 123 }, (_, n) => ({ id: 'extra-' + n })); render(); });
  assert.equal(await badge('inbox').innerText(), '99+');
  assert.match(await page.locator('#nav-count-inbox').textContent(), /123/);
  const largeBounds = await badge('inbox').boundingBox();
  assert.ok(largeBounds.x + largeBounds.width <= 66);
  await page.evaluate(() => { state.theme = 'dark'; render(); });
  assert.equal(await badge('inbox').evaluate(el => getComputedStyle(el).color), 'rgb(24, 35, 48)');
  await page.screenshot({ path: join(evidence, `sidebar-${desktop ? 'desktop' : 'web'}-dark.png`) });
  await page.evaluate(() => { state.theme = 'light'; render(); });
  await page.evaluate(() => { DB.inbox = []; DB.tasks = { must: [], should: [], could: [] }; render(); });
  assert.equal(await badge('inbox').count(), 0);
  assert.equal(await badge('today').count(), 0);
  await page.locator('.workspace-switch').click();
  await page.locator('[data-action="profile-photo-remove"]').click();
  await page.locator(`[data-action="avatar-color"][data-color="${originalColor}"]`).click();
  await page.locator('[data-action="save-profile"]').click();
  assert.equal(await page.locator('.workspace-avatar img').count(), 0);
  await page.evaluate(() => persistWorkbench());
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => DB.user.avatarImage), '');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, desktop, checks: 'single settings, avatar colors/photo/persistence/errors/cancel, live sidebar counts and responsive badges' }));
} finally {
  if (application) await application.close();
  if (browser) await browser.close();
}
