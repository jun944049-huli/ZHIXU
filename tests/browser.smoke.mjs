import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = resolve('.desktop-test');
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const finishAnimations = () => page.evaluate(() => Promise.all(
  document.getAnimations().filter(animation =>
    animation.effect?.getComputedTiming().iterations !== Infinity
  ).map(animation => animation.finished.catch(() => {}))
));
try {
  await page.goto(process.env.XIAOYU_BROWSER_URL || 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator('#view [data-action="new-project"]').click();
  await page.locator('#project-name').fill('浏览器持久化验收');
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => DB.projects.some(p => p.name === '浏览器持久化验收'));
  const projectId = await page.evaluate(() => state.projectId);
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.evaluate(id => !!projectById(id), projectId), true);
  await page.locator(`[data-action="project"][data-id="${projectId}"]`).first().click();
  await page.locator('[data-action="delete-project"]').click();
  await page.locator('[data-action="confirm-delete-project"]').click();
  await page.waitForFunction(id => !projectById(id), projectId);
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.evaluate(id => !!projectById(id), projectId), false);
  await page.locator('[data-action="nav"][data-view="data"]').click();
  for (const id of ['feishu', 'dingtalk', 'wecom', 'mail', 'ics']) {
    await page.locator(`.connector-card[data-id="${id}"]`).click();
    assert.equal(await page.locator('[data-action="connector-save"]').isDisabled(), true);
    assert.match(await page.locator('.integration-notice').innerText(), /桌面测试版/);
    await page.locator('.integration-modal [data-action="close-modal"]').click();
  }
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator('.project-register').scrollIntoViewIfNeeded();
  await finishAnimations();
  await page.screenshot({ path: resolve(evidence, 'browser-project-register.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await finishAnimations();
  await page.screenshot({ path: resolve(evidence, 'browser-project-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => ({
    width: innerWidth, document: document.documentElement.scrollWidth,
    view: document.querySelector('#view').getBoundingClientRect().right
  }));
  assert.ok(overflow.document <= overflow.width + 1 && overflow.view <= overflow.width + 1, JSON.stringify(overflow));
  await page.locator('#view [data-action="new-project"]').click();
  await finishAnimations();
  const modal = await page.locator('.project-editor').boundingBox();
  assert.ok(modal.x >= 0 && modal.x + modal.width <= 391);
  await page.screenshot({ path: resolve(evidence, 'browser-project-mobile-modal.png') });
  await page.locator('.project-editor [data-action="close-modal"]').first().click();
  await page.locator('[data-action="nav"][data-view="data"]').click();
  await page.locator('.connector-card[data-id="mail"]').click();
  await finishAnimations();
  const integrationModal = await page.locator('.integration-modal').boundingBox();
  assert.ok(integrationModal.x >= 0 && integrationModal.x + integrationModal.width <= 391);
  await page.screenshot({ path: resolve(evidence, 'browser-integration-mobile.png') });
  await page.locator('.integration-modal [data-action="close-modal"]').click();
  for (const view of ['today', 'chat', 'inbox', 'projects', 'reports', 'profile', 'data']) {
    await page.locator(`.nav [data-action="nav"][data-view="${view}"]`).click();
    await finishAnimations();
    const dimensions = await page.evaluate(() => ({
      width: innerWidth, document: document.documentElement.scrollWidth,
      right: document.querySelector('#view').getBoundingClientRect().right
    }));
    assert.ok(dimensions.document <= dimensions.width + 1 && dimensions.right <= dimensions.width + 1,
      view + ': ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-mobile-${view}.png`), fullPage: true });
  }
  await page.locator('.nav [data-view="inbox"]').click();
  await page.evaluate(() => {
    DB.inboxArchive.push({ id: 'browser-archive-check', title: '归档清空布局验收', deletedAt: new Date().toISOString() });
  });
  await page.locator('[data-action="inbox-archive"]').click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await finishAnimations();
    const title = await page.locator('#modal-root h2').boundingBox();
    const clear = await page.locator('[data-action="inbox-archive-clear"]').boundingBox();
    const close = await page.locator('#modal-root [data-action="close-modal"]').boundingBox();
    assert.ok(title.x + title.width <= clear.x && clear.x + clear.width <= close.x);
    assert.ok(close.x + close.width <= width);
    await page.screenshot({ path: resolve(evidence, `browser-archive-${width}.png`) });
  }
  await page.locator('[data-action="inbox-archive-clear"]').click();
  await page.locator('#modal-root [data-action="inbox-archive"]').click();
  assert.equal(await page.evaluate(() => DB.inboxArchive.some(i => i.id === 'browser-archive-check')), true);
  await page.locator('#modal-root [data-action="close-modal"]').click();
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles({ name: '附件编辑布局验收.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 项目名称：移动附件验收\n完成设备清单整理\n提交验收材料') });
  await page.locator('[data-action="document-import"]').click();
  await page.locator('.document-editor').waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await finishAnimations();
    const dimensions = await page.locator('.document-editor').evaluate(element => ({
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      bodyWidth: element.querySelector('.modal-body').clientWidth,
      bodyScroll: element.querySelector('.modal-body').scrollWidth
    }));
    assert.ok(dimensions.left >= 0 && dimensions.right <= width && dimensions.bodyScroll <= dimensions.bodyWidth + 1,
      'document editor: ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-document-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, projectId, overflow }));
} finally {
  await browser.close();
}
