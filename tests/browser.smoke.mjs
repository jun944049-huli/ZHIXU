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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, projectId, overflow }));
} finally {
  await browser.close();
}
