import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'capture-profile-'));
let deny = false, held, hold = false;
const requests = [];
const server = createServer((request, response) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    const body = JSON.parse(raw);
    requests.push(body);
    response.setHeader('Content-Type', 'application/json');
    if (deny) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: { message: 'invalid sk-capture-smoke-key' } }));
      return;
    }
    const send = () => response.end(JSON.stringify({ model: 'concise-model',
      output: [{ type: 'message', content: [{ type: 'output_text',
        text: '{"title":"整理验收清单并发给小陈"}' }] }] }));
    if (hold) held = send;
    else send();
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
};
async function assertButtons() {
  const parse = await page.locator('#parse-btn').boundingBox();
  const save = await page.locator('#capture-save').boundingBox();
  assert.ok(Math.abs(parse.y - save.y) < 2, 'save and reparse must share one row');
  assert.ok(parse.x + parse.width <= save.x, 'buttons must not overlap');
  const foot = await page.locator('.capture-actions').boundingBox();
  assert.ok(save.x + save.width <= foot.x + foot.width);
}
try {
  await launch();
  await page.evaluate(() => { state.view = 'project'; state.projectId = 'p1'; state.projectTab = 'tasks'; render(); });
  assert.deepEqual(await page.locator('[data-action="project-task"]').allTextContents(),
    [' 添加事项', ' 添加事项']);
  await page.locator('[data-action="project-task"]').last().click();
  await page.locator('#capture-text').fill('我要给青禾小学搬砖');
  await page.locator('#parse-btn').click();
  assert.equal(await page.locator('#capture-title').inputValue(), '为青禾小学搬砖');
  assert.equal(await page.locator('#capture-project').inputValue(), 'p1');
  await assertButtons();
  await page.locator('#capture-title').fill('本地整理验收');
  await page.locator('#capture-save').click();
  await page.waitForFunction(() => !document.querySelector('.capture-modal'));
  assert.equal(await page.evaluate(() => allWorkbenchTasks().find(t => t.title === '本地整理验收').project), 'p1');

  await page.evaluate(baseUrl => {
    DB.settings.aiProvider = 'custom';
    DB.settings.customProvider = { name: '测试供应商', baseUrl, apiKey: 'sk-capture-smoke-key',
      model: 'capture-model', protocol: 'responses' };
    openCapture('p1');
  }, `http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#capture-engine').innerText(), 'capture-model');
  const raw = '我明天要把验收那份清单弄一下，然后发给小陈';
  await page.locator('#capture-text').fill(raw);
  await page.locator('#parse-btn').click();
  await page.waitForFunction(() => !document.querySelector('#parse-btn').disabled);
  assert.equal(await page.locator('#capture-title').inputValue(), '整理验收清单并发给小陈');
  assert.equal(await page.locator('#capture-engine').innerText(), 'concise-model');
  assert.ok(requests.length > 0);
  await assertButtons();
  await page.setViewportSize({ width: 496, height: 604 });
  await assertButtons();
  assert.equal(await page.locator('.capture-modal').evaluate(el => el.scrollWidth > el.clientWidth), false);
  await page.screenshot({ path: join(evidence, 'capture-narrow.png'), animations: 'disabled', scale: 'css' });
  await page.setViewportSize({ width: 1280, height: 820 });
  deny = true;
  await page.locator('#parse-btn').click();
  await page.waitForFunction(() => !document.querySelector('#parse-btn').disabled);
  assert.match(await page.locator('#capture-feedback').innerText(), /解析失败/);
  assert.equal((await page.locator('#capture-feedback').innerText()).includes('sk-capture-smoke-key'), false);
  assert.equal(await page.locator('#capture-text').inputValue(), raw);
  assert.equal(await page.locator('#capture-title').inputValue(), '整理验收清单并发给小陈');
  deny = false; hold = true;
  await page.locator('#parse-btn').click();
  await page.waitForFunction(() => document.querySelector('#parse-btn').disabled);
  assert.equal(await page.locator('#capture-save').isDisabled(), true);
  await page.locator('#capture-text').fill(raw + '，补充内容');
  for (let attempt = 0; !held && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(held); held();
  await page.waitForFunction(() => !document.querySelector('#parse-btn').disabled);
  assert.match(await page.locator('#capture-feedback').innerText(), /内容已修改/);
  await page.locator('#capture-save').click();
  assert.equal(await page.locator('.capture-modal').count(), 1);
  hold = false;
  await page.locator('#parse-btn').click();
  await page.waitForFunction(() => !document.querySelector('#parse-btn').disabled);
  await page.locator('#capture-save').click();
  await page.waitForFunction(() => !document.querySelector('.capture-modal'));
  await page.evaluate(() => persistWorkbench());
  assert.equal(await page.evaluate(() => DB.sourceItems.at(-1).raw), raw + '，补充内容');
  await app.close(); app = null;
  await launch();
  assert.equal(await page.evaluate(() => allWorkbenchTasks().filter(t => t.title === '整理验收清单并发给小陈').length), 1);
  assert.equal(await page.evaluate(() => DB.sourceItems.at(-1).raw), raw + '，补充内容');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, modelParsing: true, localParsing: true,
    projectLabels: true, alignedDesktopAndNarrowButtons: true, failedDraftRetained: true,
    staleInputRejected: true, sourceAndRestart: true, profile }));
} finally {
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
}
