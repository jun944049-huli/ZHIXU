import { chromium, _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

const evidence = resolve('.desktop-test');
mkdirSync(evidence, { recursive: true });
const desktop = Boolean(process.env.XIAOYU_TEST_EXE);
let application, browser;
try {
  let page;
  if (desktop) {
    const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
    application = await electron.launch({ executablePath: process.env.XIAOYU_TEST_EXE,
      env: { ...env, XIAOYU_DATA_DIR: mkdtempSync(join(evidence, 'overdue-layout-')) } });
    page = await application.firstWindow();
  } else {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    await page.goto(process.env.XIAOYU_BROWSER_URL || 'http://127.0.0.1:5174/');
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.evaluate(() => {
    DB.tasks = { must: [], should: [], could: [] }; DB.taskCalendar = {}; DB.overdue = [];
    ['清单', '整理星火联调问题并发给王总', '修复演示环境登录问题',
      '确认客户成功中台灰度名单', '补充验收清单'.repeat(18)].forEach((title, index) =>
      addConfirmedTask({ id: `layout-${index}`, title, due: addDaysISO(DB.meta.today, -2),
        priority: 'P2', estimate: '1h' }, DB.meta.today, 'should'));
    openOverdue();
  });
  const widths = desktop ? [1440, 960] : [1440, 960, 640, 496, 390, 320];
  for (const width of widths) {
    if (desktop) await application.evaluate(({ BrowserWindow }, width) =>
      BrowserWindow.getAllWindows()[0].setContentSize(width, 960), width);
    else await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))));
      const layout = await page.locator('.overdue-list .feature-list-row').evaluateAll(rows =>
        rows.map(row => {
          const bounds = element => {
            const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
            return { x, y, width, height, right, bottom };
          };
          const buttons = [...row.querySelectorAll('button')];
          return { row: bounds(row), title: bounds(row.firstElementChild),
            buttons: buttons.map(bounds), overflowing: buttons.some(button => button.scrollWidth > button.clientWidth) };
        }));
      assert.equal(layout.length, 5);
      for (const row of layout) {
        assert.equal(row.overflowing, false, `${width}: button text clipped`);
        row.buttons.forEach((button, index) => {
          assert.ok(Math.abs(button.x - layout[0].buttons[index].x) < 1, `${width}: column moved`);
          assert.ok(Math.abs(button.width - row.buttons[0].width) < 1, `${width}: widths differ`);
          assert.equal(button.height, 36);
          assert.ok(button.x >= row.row.x - 1 && button.right <= row.row.right + 1, `${width}: row overflow`);
        });
        assert.ok(row.buttons[0].right <= row.buttons[1].x, `${width}: buttons overlap`);
        if (width <= 640) assert.ok(row.title.bottom <= row.buttons[0].y, `${width}: title overlaps buttons`);
        else assert.ok(row.title.right <= row.buttons[0].x, `${width}: title overlaps actions`);
      }
      await page.screenshot({ path: join(evidence, `overdue-layout-${desktop ? 'desktop' : 'web'}-${width}-${theme}.png`),
        animations: 'disabled' });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, desktop, widths, themes: ['light', 'dark'],
    checks: 'aligned columns, equal button sizes, long titles, no clipping or overlap' }));
} finally { await application?.close(); await browser?.close(); }
