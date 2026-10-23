import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'plugins-profile-'));
const source = mkdtempSync(join(evidence, '本地 MCP 插件 '));
const bad = mkdtempSync(join(evidence, 'incompatible-plugin-'));
writeFileSync(join(bad, 'package.json'), JSON.stringify({ name: 'dsh-plugin-example', version: '1.0.0', main: 'index.js' }));
writeFileSync(join(bad, 'index.js'), '');
writeFileSync(join(source, 'package.json'), JSON.stringify({
  name: 'zhixu-mcp-test', version: '1.0.0', type: 'module', bin: { 'mcp-test': 'server.mjs' },
  scripts: { postinstall: 'node postinstall.cjs', prepare: 'node postinstall.cjs' }
}));
writeFileSync(join(source, 'postinstall.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(join(profile, 'script-executed'))},'bad')`);
writeFileSync(join(source, 'server.mjs'), `
import { createInterface } from 'node:readline';
if(!process.env.TEST_TOKEN){console.error('TEST_TOKEN is required');process.exit(1);}
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
 const req=JSON.parse(line);if(req.id===undefined)return;
 let result={};
 if(req.method==='initialize')result={protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 if(req.method==='tools/list')result={tools:[{name:'echo',description:'Echo test',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
 if(req.method==='tools/call')result={content:[{type:'text',text:req.params.arguments.text+' / '+process.env.TEST_TOKEN+' / '+process.argv.slice(2).join(',')}]};
 console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));
});`);
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
let application;
const errors = [];
async function launch() {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile, ZHIXU_PLUGIN_FIXTURE: source }
  });
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  return page;
}
try {
  let page = await launch();
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.ZHIXU_PLUGIN_FIXTURE] });
  });
  await page.locator('.nav [data-view="data"]').click();
  assert.equal(await page.locator('[data-action="connector-config"][data-id="manual"]').count(), 0);
  await page.locator('[data-action="plugin-open"]').click();
  await page.locator('#plugin-list [data-action="plugin-add"]').click();
  assert.equal(await page.locator('[data-action="plugin-install"]').isDisabled(), true);
  await page.locator('#plugin-source').fill(bad);
  await page.locator('[data-action="plugin-install"]').click();
  await page.waitForFunction(() => document.getElementById('plugin-result')?.textContent.includes('不是可识别的 MCP'));
  assert.equal(await page.locator('#plugin-source').inputValue(), bad);
  assert.equal(await page.locator('[data-action="plugin-install"]').isEnabled(), true);
  assert.equal((await page.evaluate(() => window.xiaoyuDesktop.plugins({ action: 'list' }))).plugins.length, 0);
  assert.equal(readdirSync(join(profile, 'plugins')).filter(name => /^[0-9a-f]{8}-/.test(name)).length, 0);
  await page.locator('[data-action="plugin-pick"]').click();
  assert.equal(await page.locator('#plugin-source').inputValue(), source);
  await page.locator('[data-action="plugin-install"]').click();
  await page.waitForSelector('#plugin-args', { timeout: 45000 });
  assert.equal(existsSync(join(profile, 'script-executed')), false);
  const id = (await page.evaluate(() => window.xiaoyuDesktop.plugins({ action: 'list' }))).plugins[0].id;
  await page.locator('[data-action="plugin-connect"]').click();
  await page.waitForFunction(() => document.getElementById('plugin-result')?.textContent.includes('TEST_TOKEN is required'));
  await page.locator('#plugin-args').fill('["folder with spaces"]');
  await page.locator('#plugin-env').fill('{"TEST_TOKEN":"test-private-secret-123"}');
  await page.locator('[data-action="plugin-connect"]').click();
  await page.waitForSelector('#plugin-tool', { timeout: 30000 });
  assert.equal(await page.locator('#plugin-env').inputValue(), '');
  assert.equal(await page.locator('#plugin-env').getAttribute('placeholder').then(x => x.includes('TEST_TOKEN')), true);
  assert.equal(readFileSync(join(profile, 'plugins', 'registry.json'), 'utf8').includes('test-private-secret-123'), false);
  await page.locator('#plugin-tool-arguments').fill('{"text":"actual tool execution"}');
  await page.locator('[data-action="plugin-call"]').click();
  await page.waitForFunction(() => !document.getElementById('plugin-tool-output').hidden);
  const output = await page.locator('#plugin-tool-output').innerText();
  assert.match(output, /actual tool execution/);
  assert.match(output, /folder with spaces/);
  assert.match(output, /已隐藏/);
  assert.doesNotMatch(output, /test-private-secret-123/);
  const invalidEnvironment = await page.evaluate(id => window.xiaoyuDesktop.plugins({
    action: 'configure', id, env: { node_options: '--require=outside.cjs' }
  }).then(() => '', error => error.message), id);
  assert.match(invalidEnvironment, /不允许覆盖/);
  await page.screenshot({ path: join(evidence, 'plugins-connected-desktop.png'), fullPage: true });
  await page.locator('[data-action="plugin-disable"]').click();
  await page.waitForFunction(() => !document.getElementById('plugin-tool'));
  assert.equal((await page.evaluate(() => window.xiaoyuDesktop.plugins({ action: 'list' }))).plugins[0].status, 'disabled');
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="plugin-add"]').first().click();
  await page.locator('#plugin-source').fill(source);
  await page.locator('[data-action="plugin-install"]').click();
  await page.waitForFunction(() => document.getElementById('plugin-result')?.textContent.includes('此插件已安装'));
  assert.equal(await page.locator('#plugin-source').inputValue(), source);
  await page.locator('[data-action="close-modal"]').click();
  await application.close();
  page = await launch();
  await page.locator('.nav [data-view="data"]').click();
  await page.locator('[data-action="data-tab"][data-tab="plugins"]').click();
  await page.locator('[data-action="plugin-manage"]').click();
  await page.locator('[data-action="plugin-connect"]').click();
  await page.waitForSelector('#plugin-tool');
  assert.deepEqual((await page.evaluate(() => window.xiaoyuDesktop.plugins({ action: 'list' }))).plugins[0].args, ['folder with spaces']);
  await page.locator('[data-action="plugin-remove-confirm"]').click();
  await page.locator('[data-action="plugin-remove-cancel"]').click();
  assert.equal(await page.locator('#plugin-tool').count(), 1);
  await page.locator('[data-action="plugin-remove-confirm"]').click();
  await page.locator('[data-action="plugin-remove"]').click();
  await page.waitForFunction(() => !document.querySelector('.plugin-modal'));
  assert.equal((await page.evaluate(() => window.xiaoyuDesktop.plugins({ action: 'list' }))).plugins.length, 0);
  assert.equal(existsSync(join(profile, 'plugins', id)), false);
  assert.equal(existsSync(join(source, 'server.mjs')), true);
  await application.close();
  writeFileSync(join(profile, 'plugins', 'registry.json'), '{broken registry');
  page = await launch();
  assert.ok(await page.locator('.nav [data-view="today"]').count());
  await page.locator('.nav [data-view="data"]').click();
  await page.locator('[data-action="data-tab"][data-tab="plugins"]').click();
  await page.waitForFunction(() => document.getElementById('plugin-list')?.textContent.includes('插件记录无法读取'));
  assert.deepEqual(errors, []);
  console.log('Plugin lifecycle passed: real npm install, failure retention, skipped scripts, MCP connection, encrypted configuration, actual tool call, restart, disable and uninstall.');
} catch (error) {
  const pages = application?.windows() || [];
  if (pages[0]) {
    console.error(await pages[0].locator('#modal-root').innerText().catch(() => 'No modal'));
    await pages[0].screenshot({ path: join(evidence, 'plugins-failure.png') }).catch(() => {});
  }
  console.error({ profile, errors });
  throw error;
} finally { if (application) await application.close(); }
