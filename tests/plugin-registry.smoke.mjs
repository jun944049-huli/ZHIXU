import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Optional network check: installs the official filesystem MCP in an isolated profile.
const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'registry-plugin-profile-'));
const files = mkdtempSync(join(evidence, 'registry-plugin-files-'));
writeFileSync(join(files, 'registry-fixture.txt'), 'isolated fixture');
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
const application = await electron.launch({
  executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
  args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
  cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
});
try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  const result = await page.evaluate(async path => {
    const api = window.xiaoyuDesktop;
    const install = await api.plugins({ action: 'install', source: '@modelcontextprotocol/server-filesystem', registry: 'official' });
    const id = install.id;
    try {
      await api.plugins({ action: 'configure', id, args: [path] });
      const connected = await api.plugins({ action: 'connect', id });
      const output = await api.plugins({ action: 'call', id, tool: 'list_directory', arguments: { path } });
      return { name: connected.plugins[0].name, version: connected.plugins[0].version,
        status: connected.plugins[0].status, text: output.text };
    } finally { await api.plugins({ action: 'remove', id }); }
  }, files);
  assert.equal(result.name, '@modelcontextprotocol/server-filesystem');
  assert.equal(result.status, 'connected');
  assert.match(result.text, /registry-fixture\.txt/);
  console.log(JSON.stringify({ passed: true, name: result.name, version: result.version, registry: 'official' }));
} finally { await application.close(); }
