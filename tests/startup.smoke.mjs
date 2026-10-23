import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const profile = mkdtempSync(join(evidence, 'startup-profile-'));
const samples = [];
for (let attempt = 0; attempt < Number(process.env.XIAOYU_STARTUP_RUNS || 3); attempt++) {
  const started = performance.now();
  const application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    env: { ...env, XIAOYU_DATA_DIR: profile },
    timeout: Number(process.env.XIAOYU_STARTUP_TIMEOUT || 30000)
  });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
    const ms = Math.round(performance.now() - started);
    samples.push(ms);
    assert.ok(await page.locator('.workspace-switch').isVisible());
    assert.ok(ms < Number(process.env.XIAOYU_STARTUP_TIMEOUT || 30000), `startup took ${ms}ms`);
  } finally { await application.close(); }
}
const result = { executable: process.env.XIAOYU_TEST_EXE || 'development', readyMilliseconds: samples };
writeFileSync(join(evidence, process.env.XIAOYU_STARTUP_RESULT || 'startup-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
