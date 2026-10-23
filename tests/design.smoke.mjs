import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve('design-review');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.evaluate(() => Promise.all(document.getAnimations()
  .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
  .map(animation => animation.finished.catch(() => {}))));
const nav = view => page.locator(`.nav [data-view="${view}"]`).click();
const close = () => page.locator('#modal-root [data-action="close-modal"]').first().click();
async function snapshot(name) {
  await settle();
  await page.screenshot({ path: resolve(output, name + '.png'), animations: 'disabled' });
}
async function checkBounds(label) {
  const size = await page.evaluate(() => ({
    width: innerWidth, content: document.documentElement.scrollWidth
  }));
  assert.ok(size.content <= size.width + 1, label + ': ' + JSON.stringify(size));
  const missing = await page.locator('img').evaluateAll(images => images
    .filter(image => !image.complete || !image.naturalWidth).map(image => image.src));
  assert.deepEqual(missing, [], label + ': broken images');
}
try {
  await page.goto(process.env.XIAOYU_BROWSER_URL || 'http://127.0.0.1:5174/');
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.locator('.brand-name').innerText(), '知序');
  assert.match(await page.title(), /知序/);
  const assistant = await page.evaluate(() => DB.settings.assistantName);
  await page.evaluate(() => { DB.settings.assistantName = '工作助手'; render(); });
  assert.equal(await page.evaluate(() => assistantName()), '工作助手');
  assert.equal(await page.locator('.brand-name').innerText(), '知序');
  assert.match(await page.title(), /知序/);
  await page.evaluate(value => { DB.settings.assistantName = value; render(); }, assistant);
  assert.equal(await page.locator('.brand-sub, .ai-status-card, .chat-safety, .impact-card').count(), 0);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 496, height: 604 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.getByRole('button', { name: '收件箱', exact: true }).count(), 1);
    for (const view of ['today', 'chat', 'inbox', 'projects', 'reports', 'profile', 'data']) {
      await nav(view);
      await checkBounds(`${view} ${viewport.width}`);
      await snapshot(`${view}-${viewport.width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav('chat');
  await page.locator('[data-action="workspace-toggle"]').click();
  await snapshot('chat-workspace');
  for (const tab of ['files', 'terminal', 'browser']) {
    await page.locator(`.workspace-tabs [data-tab="${tab}"]`).click();
    await snapshot('workspace-' + tab);
  }
  await page.setViewportSize({ width: 496, height: 604 });
  await page.locator('.workspace-heading').click();
  await checkBounds('workspace 496');
  await snapshot('workspace-496');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="workspace-toggle"]').first().click();
  await nav('projects');
  assert.ok(await page.locator('.project-card').count() > 0);
  assert.equal(await page.locator('.project-register').count(), 0);
  const before = await page.evaluate(() => JSON.stringify(DB.projects));
  await page.locator('[data-action="project-display"][data-mode="list"]').click();
  assert.equal(await page.locator('.project-card').count(), 0);
  assert.ok(await page.locator('.project-register tbody tr').count() > 0);
  assert.equal(await page.evaluate(() => JSON.stringify(DB.projects)), before);
  await snapshot('projects-list');
  await page.locator('[data-action="project-display"][data-mode="grid"]').click();
  await page.locator('#view [data-action="new-project"]').click();
  assert.equal(await page.locator('.project-advanced').getAttribute('open'), null);
  await page.locator('#project-name').fill('知序流程验收');
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => DB.projects.some(project => project.name === '知序流程验收'));

  await page.locator('[data-action="profile-settings"]').first().click();
  await page.locator('#profile-name').fill('未保存的名称');
  await page.locator('#settings-tab-general').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#settings-tab-models').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#custom-provider-base').isVisible(), true);
  assert.equal(await page.locator('#profile-name').isVisible(), false);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#settings-tab-general').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#profile-name').inputValue(), '未保存的名称');
  await close();
  assert.notEqual(await page.evaluate(() => DB.user.name), '未保存的名称');
  await page.locator('[data-action="model-settings"]').click();
  assert.equal(await page.locator('#custom-provider-base').isVisible(), true);
  assert.equal(await page.locator('.provider-advanced').getAttribute('open'), null);
  await snapshot('settings-model');
  await close();
  await page.locator('[data-action="profile-settings"]').first().click();
  await snapshot('settings-general');
  await close();

  await nav('data');
  assert.equal(await page.locator('#workflow-input').isVisible(), false);
  assert.equal(await page.locator('.connector-card:disabled').count(), 0);
  await page.locator('[data-action="data-tab"][data-tab="workflow"]').click();
  await page.locator('#workflow-input').fill('先确认今天的空余时间，再安排临时任务。');
  await page.locator('[data-action="data-tab"][data-tab="connections"]').click();
  await page.locator('[data-action="data-tab"][data-tab="workflow"]').click();
  assert.equal(await page.locator('#workflow-input').inputValue(), '先确认今天的空余时间，再安排临时任务。');
  await page.locator('[data-action="save-workflow"]').click();
  assert.match(await page.evaluate(() => DB.workflow.text), /临时任务/);
  await snapshot('data-workflow');
  await page.locator('[data-action="data-tab"][data-tab="storage"]').click();
  assert.equal(await page.locator('[data-action="data-export"]').isVisible(), true);
  await snapshot('data-storage');
  await page.locator('[data-action="data-tab"][data-tab="plugins"]').click();
  await snapshot('plugins-desktop');
  await page.locator('#plugin-list [data-action="plugin-add"]').click();
  assert.equal(await page.locator('#plugin-source').isVisible(), true);
  assert.match(await page.locator('#plugin-result').innerText(), /桌面版/);
  await snapshot('plugins-install-desktop');
  await page.setViewportSize({ width: 496, height: 604 });
  await checkBounds('plugins installer 496');
  await snapshot('plugins-install-496');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkBounds('plugins installer 390');
  await snapshot('plugins-install-390');
  await close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav('chat');
  assert.equal(await page.locator('.chat-rail').count(), 0);
  await page.locator('#chat-input').fill('切换参考内容时保留草稿');
  await page.locator('[data-action="chat-details"]').click();
  assert.equal(await page.locator('.chat-rail').isVisible(), true);
  assert.equal(await page.locator('#chat-input').inputValue(), '切换参考内容时保留草稿');
  await page.locator('.chat-rail [data-action="chat-details"]').click();
  assert.equal(await page.locator('.chat-rail').count(), 0);
  await page.locator('#chat-input').fill('');
  await page.locator('[data-action="theme"]').click();
  await snapshot('chat-dark');
  await nav('projects');
  await snapshot('projects-dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(26, 27, 30)');
  assert.deepEqual(errors, []);

  await page.setViewportSize({ width: 512, height: 512 });
  for (const variant of ['a', 'b', 'c', 'd']) {
    const svg = readFileSync(resolve('prototype/brand', `zhixu-${variant}.svg`)).toString('base64');
    await page.setContent(`<style>html,body{margin:0;width:512px;height:512px;background:transparent}img{display:block;width:512px;height:512px}</style><img src="data:image/svg+xml;base64,${svg}">`);
    await page.locator('img').evaluate(image => image.decode());
    await page.screenshot({ path: resolve(output, `zhixu-${variant}.png`), omitBackground: true });
  }
  await page.setViewportSize({ width: 1200, height: 690 });
  await page.goto(pathToFileURL(resolve(output, '品牌方案.html')).href);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
  await snapshot('品牌方案');
  writeFileSync(resolve(output, 'checks.json'), JSON.stringify({
    passed: true, views: 7, desktopAndMobile: true, theme: true, brandAssets: 4,
    settingsDraftsPreserved: true, projectViewToggle: true, singleNameProjectCreation: true,
    workflowDraftPreserved: true, contextualDisclosure: true, pluginInstallerResponsive: true, consoleErrors: errors
  }, null, 2));
  console.log(JSON.stringify({ passed: true, views: 7, screenshots: output }));
} finally {
  await browser.close();
}
