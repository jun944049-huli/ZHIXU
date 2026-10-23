import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'provider-profile-'));
const key = 'sk-isolated-provider-test';
const paths = [];
const server = createServer((request, response) => {
  paths.push(request.url);
  response.setHeader('Content-Type', 'application/json');
  if (request.headers.authorization !== `Bearer ${key}`) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: { message: 'invalid key sk-isolated-bad-key' } }));
    return;
  }
  if (request.url === '/v1/models') {
    response.end(JSON.stringify({ data: [{ id: 'image-model' }, { id: 'text-model' }, { id: 'second-model' }] }));
    return;
  }
  if (request.url !== '/v1/responses') {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'Responses endpoint required' } }));
    return;
  }
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const payload = JSON.parse(body);
    if (payload.model === 'forbidden-model') {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: { message: 'model access denied' } }));
      return;
    }
    assert.equal(payload.store, false);
    let text = '真实协议已连接';
    if (payload.input.some(item => item.content.includes('untrustedDocument'))) {
      text = JSON.stringify({ summary: '接口分析验收', projectId: null, projectName: '供应商测试',
        tasks: [{ title: '核对供应商附件', assignee: '', due: '', priority: 'P2', estimateHours: 0, evidence: '完成供应商附件核对' }] });
    }
    response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message',
      content: [{ type: 'output_text', text }] }] }));
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let application, page;
const errors = [];
async function launch() {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
}
const diagnose = async () => {
  await page.locator('[data-action="test-custom-provider"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="test-custom-provider"]').disabled);
};
async function screenshot(name) {
  if (process.env.XIAOYU_SKIP_SCREENSHOTS === '1') return;
  await page.screenshot({ path: join(evidence, name), timeout: 15000 });
}

try {
  await launch();
  await page.locator('[data-action="model-settings"]').first().click();
  await page.locator('.provider-advanced summary').click();
  await page.locator('#custom-provider-base').fill(baseUrl);
  await page.locator('#custom-provider-key').fill(key);
  await page.waitForFunction(() => document.getElementById('custom-provider-model').value === 'text-model');
  assert.equal(await page.locator('#custom-provider-model-select option').count(), 4);
  await diagnose();
  assert.equal(await page.evaluate(() => state.customProviderTested), true);
  assert.equal(await page.locator('#custom-provider-protocol').inputValue(), 'responses');
  assert.equal(await page.locator('.provider-check.pass').count(), 4);
  assert.match(await page.locator('#custom-provider-diagnosis').innerText(), /\/v1\/responses/);
  assert.equal((await page.locator('#custom-provider-diagnosis').innerText()).includes(key), false);
  await screenshot('provider-diagnosis-pass.png');

  await page.locator('#custom-provider-key').fill('sk-isolated-bad-key');
  await page.locator('#custom-provider-model').fill('text-model');
  assert.equal(await page.evaluate(() => state.customProviderTested), false);
  assert.equal(await page.locator('.provider-check').count(), 0);
  await diagnose();
  assert.equal(await page.evaluate(() => state.customProviderTested), false);
  const failure = await page.locator('#custom-provider-diagnosis').innerText();
  assert.match(failure, /401.*鉴权失败/);
  assert.equal(failure.includes('sk-isolated-bad-key'), false);
  assert.equal(await page.locator('#custom-provider-key').inputValue(), 'sk-isolated-bad-key');
  assert.equal(await page.locator('#custom-provider-base').inputValue(), baseUrl);
  await screenshot('provider-diagnosis-failure.png');

  await page.locator('#custom-provider-key').fill(key);
  await page.locator('#custom-provider-model').fill('forbidden-model');
  await diagnose();
  assert.match(await page.locator('#custom-provider-diagnosis').innerText(), /403.*model access denied/);
  assert.equal(await page.locator('#custom-provider-model').inputValue(), 'forbidden-model');
  await page.locator('[data-action="fetch-custom-models"]').click();
  await page.waitForFunction(() => document.getElementById('custom-provider-result').textContent.includes('已获取'));
  assert.equal(await page.locator('#custom-provider-model').inputValue(), 'forbidden-model');
  await page.locator('#custom-provider-model-select').selectOption('second-model');
  await diagnose();
  assert.equal(await page.evaluate(() => state.customProviderTested), true);
  await page.locator('[data-action="save-profile"]').click();
  await page.waitForFunction(() => !document.getElementById('custom-provider-key'));
  const saved = await page.evaluate(() => ({ protocol: aiProviderConfig().protocol, model: aiProviderConfig().model,
    tested: !!DB.settings.customProvider.testedAt }));
  assert.deepEqual(saved, { protocol: 'responses', model: 'second-model', tested: true });
  assert.equal(await page.evaluate(() => requestAIPolish('保留事实', '简洁')), '真实协议已连接');
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles({
    name: '供应商验收.md', mimeType: 'text/markdown', buffer: Buffer.from('完成供应商附件核对')
  });
  assert.equal(await page.locator('#document-engine').inputValue(), 'ai');
  await page.locator('[data-action="document-import"]').click();
  await page.waitForFunction(() => !state.documentImportBusy);
  assert.match(await page.locator('#document-summary').inputValue(), /接口分析验收/);
  assert.equal(await page.locator('#draft-title-0').inputValue(), '核对供应商附件');
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await page.evaluate(() => persistWorkbench());
  await application.close();
  const sqlite = readFileSync(join(profile, 'workbench.sqlite'));
  assert.equal(sqlite.includes(Buffer.from(key)), false);
  await launch();
  assert.deepEqual(await page.evaluate(() => ({ protocol: aiProviderConfig().protocol, model: aiProviderConfig().model })),
    { protocol: 'responses', model: 'second-model' });
  assert.equal(await page.evaluate(() => requestAIPolish('重启测试', '简洁')), '真实协议已连接');
  assert.deepEqual(errors, []);
  const result = { passed: true, modelsAutoFetched: 3, autoProtocol: 'responses',
    detailedFailures: [401, 403], credentialsEncrypted: true, realPolishAndDocumentAnalysis: true,
    persistedAcrossRestart: true, requests: paths.length, profile };
  writeFileSync(join(evidence, 'provider-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await application?.close();
  server.closeAllConnections();
  server.close();
}
