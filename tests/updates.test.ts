import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Updates, UpdatePreparationError, updateError } from '../src/main/updates';

class Engine extends EventEmitter {
  checks = 0; downloads = 0; installs = 0;
  available = true;
  downloadError = '';
  async checkForUpdates() {
    this.checks++;
    this.emit(this.available ? 'update-available' : 'update-not-available', { version: '0.3.0' });
  }
  async downloadUpdate() {
    this.downloads++;
    if (this.downloadError) throw new Error(this.downloadError);
    this.emit('download-progress', { percent: 64 });
    this.emit('update-downloaded', { version: '0.3.0' });
  }
  quitAndInstall(silent: boolean, run: boolean) {
    assert.equal(silent, true); assert.equal(run, true); this.installs++;
  }
}
function fixture(overrides: Record<string, unknown> = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'zhixu-updates-')), 'updates.json');
  const engine = new Engine();
  const states: string[] = [];
  let prepared = 0, credentials = 0;
  const deps = {
    version: '0.2.9', packaged: true,
    encrypt: (value: string) => Buffer.from(value).toString('base64'),
    decrypt: (value: string) => Buffer.from(value, 'base64').toString(),
    credential: async () => { credentials++; return 'test-private-token'; },
    engine: (_token: string) => engine,
    prepare: async () => { prepared++; },
    notify: (status: { stage: string }) => states.push(status.stage),
    ...overrides
  };
  const updates = new Updates(path, deps);
  return { updates, engine, path, deps, states, prepared: () => prepared, credentials: () => credentials };
}
test('new versions download in the background but require an explicit install', async () => {
  const f = fixture();
  const result = await f.updates.handle({ operation: 'check' });
  assert.equal(result.stage, 'ready');
  assert.equal(result.version, '0.3.0'); assert.equal(result.access, 'git');
  assert.equal(f.engine.downloads, 1); assert.equal(f.engine.installs, 0);
  assert.ok(f.states.includes('downloading'));
  await f.updates.handle({ operation: 'check' });
  assert.equal(f.engine.checks, 1);
  await f.updates.handle({ operation: 'install' });
  assert.equal(f.prepared(), 1); assert.equal(f.engine.installs, 1);
});
test('failed save or backup prevents installation and allows retry', async () => {
  let fail = true;
  const f = fixture({ prepare: async () => { if (fail) throw new UpdatePreparationError('先保存编辑'); } });
  await f.updates.handle({ operation: 'check' });
  const result = await f.updates.handle({ operation: 'install' });
  assert.equal(result.stage, 'ready'); assert.equal(result.message, '先保存编辑'); assert.equal(f.engine.installs, 0);
  fail = false;
  await f.updates.handle({ operation: 'install' }); assert.equal(f.engine.installs, 1);
});
test('checksum failure never permits installation; retry downloads again', async () => {
  const f = fixture(); f.engine.downloadError = 'sha512 checksum mismatch';
  const result = await f.updates.handle({ operation: 'check' });
  assert.equal(result.stage, 'error'); assert.match(result.message, /校验失败/);
  await assert.rejects(f.updates.handle({ operation: 'install' }), /先完成/);
  f.engine.downloadError = '';
  assert.equal((await f.updates.handle({ operation: 'check' })).stage, 'ready');
});
test('no local Git credential gives a useful private repository explanation', async () => {
  const f = fixture({ credential: async () => '' });
  const result = await f.updates.handle({ operation: 'check' });
  assert.equal(result.stage, 'error'); assert.match(result.message, /私有 GitHub/);
  assert.equal(f.engine.checks, 0);
});
test('saved credentials remain encrypted and are never returned in status or errors', async () => {
  const secret = 'github-test-sensitive-credential';
  let used = '';
  const f = fixture();
  f.deps.engine = token => { used = token; return f.engine; };
  await f.updates.handle({ operation: 'configure', automatic: false, token: secret });
  assert.equal(readFileSync(f.path, 'utf8').includes(secret), false);
  const reopened = new Updates(f.path, f.deps);
  assert.equal(reopened.status().hasToken, true);
  assert.equal(reopened.status().automatic, false);
  await reopened.handle({ operation: 'check' });
  assert.equal(used, secret); assert.equal(f.credentials(), 0);
  assert.equal(JSON.stringify(reopened.status()).includes(secret), false);
  assert.equal(updateError(`HTTP 401 Authorization: token ${secret}`).includes(secret), false);
  await reopened.handle({ operation: 'configure', automatic: true, clearToken: true });
  assert.equal(reopened.status().hasToken, false);
});
test('the current version does not download or install anything', async () => {
  const f = fixture(); f.engine.available = false;
  const result = await f.updates.handle({ operation: 'check' });
  assert.equal(result.stage, 'idle'); assert.match(result.message, /最新/);
  assert.ok(result.checkedAt); assert.equal(f.engine.downloads, 0);
});
test('credentials from an unavailable Windows identity cannot trigger an update or leak the secret', async () => {
  const f = fixture();
  await f.updates.handle({ operation: 'configure', automatic: true, token: 'secret-never-returned' });
  f.deps.decrypt = () => { throw new Error('system decrypt failed secret-never-returned'); };
  const status = await f.updates.handle({ operation: 'check' });
  assert.equal(status.stage, 'error'); assert.match(status.message, /无法解密/);
  assert.equal(JSON.stringify(status).includes('secret-never-returned'), false);
  assert.equal(f.engine.checks, 0);
});
test('concurrent checks and edits cannot replace an active download', async () => {
  let resolve!: (token: string) => void;
  const f = fixture({ credential: () => new Promise<string>(done => { resolve = done; }) });
  const pending = f.updates.handle({ operation: 'check' });
  assert.equal((await f.updates.handle({ operation: 'check' })).stage, 'checking');
  await assert.rejects(f.updates.handle({ operation: 'configure', automatic: false }), /正在进行/);
  resolve('test-token'); await pending;
  assert.equal(f.engine.checks, 1);
});
test('development preview cannot download or run an installer', async () => {
  const f = fixture({ packaged: false });
  assert.equal((await f.updates.handle({ operation: 'check' })).stage, 'unavailable');
  assert.equal(f.credentials(), 0); assert.equal(f.engine.checks, 0);
  await assert.rejects(f.updates.handle({ operation: 'install' }));
});
test('invalid commands and external update URLs are not accepted', async () => {
  const f = fixture();
  await assert.rejects(f.updates.handle({ operation: 'download-url', url: 'https://attacker.invalid/app.exe' }));
  await assert.rejects(f.updates.handle({ operation: 'configure', automatic: true, token: 'a'.repeat(4097) }));
});
test('downloaded installer launch errors allow retry and never expose raw errors', async () => {
  const f = fixture();
  await f.updates.handle({ operation: 'check' });
  f.engine.quitAndInstall = () => { f.engine.emit('error', new Error('EACCES sensitive path')); };
  const result = await f.updates.handle({ operation: 'install' });
  assert.equal(result.stage, 'ready'); assert.match(result.message, /权限/);
  assert.equal(result.message.includes('sensitive'), false);
});
test('missing metadata, network, disk and permission failures are actionable', () => {
  assert.match(updateError('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND latest.yml'), /缺少更新文件/);
  assert.match(updateError('ERR_CONNECTION_RESET'), /网络/);
  assert.match(updateError('ENOSPC'), /空间不足/);
  assert.match(updateError('EPERM'), /权限/);
});
