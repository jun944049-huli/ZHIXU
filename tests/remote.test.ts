import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { passwordHash, RemoteWeb } from '../src/main/remote-web';
import { SharedWorkbench, remoteSnapshot, remotePayload, REMOTE_SECRET } from '../src/main/remote-state';
import type { WorkbenchSnapshot } from '../src/shared/contracts';

const password = 'isolated-test-password-123';
function fixture(): WorkbenchSnapshot {
  const settings = { aiProvider: 'custom', customProvider: { apiKey: 'sk-real-host-secret',
    baseUrl: 'https://example.test/v1', model: 'test-model' },
    integrations: { mail: { host: 'mail.test', password: 'private-mail' }, ics: { url: 'https://calendar.test/private' } } };
  return { db: { meta: { today: '2026-10-24' }, projects: [{ id: 'p1', name: 'Shared project' }],
    tasks: { must: [], should: [], could: [] }, inbox: [], settings },
    preferences: { 'jw-settings': JSON.stringify(settings) } };
}
function memory() {
  let snapshot = fixture();
  return { load: () => structuredClone(snapshot), save: (value: unknown) => { snapshot = structuredClone(value as WorkbenchSnapshot); } };
}
async function host(run: (web: RemoteWeb, shared: SharedWorkbench, url: string, calls: any[]) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'zhixu-remote-'));
  await writeFile(join(directory, 'index.html'), '<html><head></head><body>workbench</body></html>');
  await writeFile(join(directory, 'remote-login.html'), '<html>login</html>');
  const shared = new SharedWorkbench(memory());
  const calls: any[] = [];
  const web = new RemoteWeb({ assets: directory, shared, password: await passwordHash(password),
    invoke: async (operation, payload) => { calls.push({ operation, payload }); return { model: 'test-model', reply: 'connected' }; },
    importDocument: async (name, bytes) => ({ name, size: bytes.length }),
    download: async () => ({ bytes: Buffer.from('original'), name: '中文资料.docx' }) });
  const url = await web.start();
  try { await run(web, shared, url, calls); }
  finally { await web.stop(); await rm(directory, { recursive: true, force: true }); }
}
async function login(url: string) {
  const result = await fetch(url + '/remote-api/login', { method: 'POST', headers: {
    Origin: url, 'X-Zhixu-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(result.status, 200);
  return result.headers.get('set-cookie')!.split(';')[0];
}
function post(url: string, path: string, cookie: string, payload: unknown) {
  return fetch(url + '/remote-api/' + path, { method: 'POST', headers: {
    Origin: url, Cookie: cookie, 'X-Zhixu-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}
function customHost(url: string, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders }>((done, fail) => {
    const request = httpRequest(url + path, { method: body === undefined ? 'GET' : 'POST', headers }, response => {
      response.resume();
      response.on('end', () => done({ status: response.statusCode!, headers: response.headers }));
    });
    request.on('error', fail); request.end(body);
  });
}

test('remote snapshots mask secrets, preserve host credentials on save and reject stale revisions', () => {
  const shared = new SharedWorkbench(memory());
  const desktopRevision = shared.revision;
  const masked = remoteSnapshot(shared.load()!);
  const text = JSON.stringify(masked);
  for (const secret of ['sk-real-host-secret', 'private-mail', 'calendar.test/private']) assert.equal(text.includes(secret), false);
  masked.db.projects[0].name = 'From phone';
  shared.save(masked, desktopRevision, true);
  assert.equal((shared.load()!.db.settings as any).customProvider.apiKey, 'sk-real-host-secret');
  assert.equal(JSON.parse(shared.load()!.preferences['jw-settings']).integrations.mail.password, 'private-mail');
  assert.throws(() => shared.save(fixture(), desktopRevision), /其他设备已更新/);
  assert.equal(shared.load()!.db.projects[0].name, 'From phone');
  assert.throws(() => remotePayload('chat', { provider: { apiKey: REMOTE_SECRET, baseUrl: 'https://attacker.test' } }, shared.load()!), /地址已修改/);
  const payload = remotePayload('chat', { provider: { apiKey: REMOTE_SECRET, baseUrl: 'https://example.test/v1' } }, shared.load()!);
  assert.equal(payload.provider.apiKey, 'sk-real-host-secret');
});

test('read-only remote round trips preserve array settings and do not create false revisions', () => {
  const store = memory();
  const original = store.load();
  (original.db.settings as any).customProvider.models = ['model-a', 'model-b'];
  original.preferences['jw-settings'] = JSON.stringify(original.db.settings);
  store.save(original);
  const shared = new SharedWorkbench(store);
  const revision = shared.revision;
  const masked = remoteSnapshot(shared.load()!);
  assert.deepEqual((masked.db.settings as any).customProvider.models, ['model-a', 'model-b']);
  masked.db = Object.fromEntries(Object.entries(masked.db).reverse()) as WorkbenchSnapshot['db'];
  assert.equal(shared.save(masked, revision, true), revision);
  assert.equal(shared.revision, revision);
});

test('remote HTTP requires login and same-origin writes; no local tools exposed', async () => {
  await host(async (_web, _shared, url) => {
    const home = await fetch(url, { redirect: 'manual' });
    assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/login');
    assert.equal((await fetch(url + '/remote-api/load')).status, 401);
    const cookie = await login(url);
    const html = await (await fetch(url, { headers: { Cookie: cookie } })).text();
    assert.match(html, /remote-client.js/);
    const loaded = await (await fetch(url + '/remote-api/load', { headers: { Cookie: cookie } })).json() as any;
    assert.equal(JSON.stringify(loaded).includes('sk-real-host-secret'), false);
    const crossSite = await fetch(url + '/remote-api/save', { method: 'POST', headers: {
      Cookie: cookie, Origin: 'https://attacker.test', 'X-Zhixu-Client': '1' }, body: '{}' });
    assert.equal(crossSite.status, 403);
    const noOrigin = await fetch(url + '/remote-api/save', { method: 'POST', headers: { Cookie: cookie }, body: '{}' });
    assert.equal(noOrigin.status, 403);
    assert.equal((await post(url, 'workspace', cookie, {})).status, 404);
    assert.equal((await post(url, 'plugins', cookie, {})).status, 404);
    const deniedHost = await customHost(url, '/remote-api/load', { Cookie: cookie, Host: 'evil.test' });
    assert.equal(deniedHost.status, 403);
    assert.equal((await fetch(url + '/..%2f..%2fpackage.json', { headers: { Cookie: cookie } })).status, 404);
    await post(url, 'logout', cookie, {});
    assert.equal((await fetch(url + '/remote-api/load', { headers: { Cookie: cookie } })).status, 401);
  });
});

test('two browsers and the desktop share data without last-writer overwrites; models use host credentials', async () => {
  await host(async (_web, shared, url, calls) => {
    const cookie = await login(url);
    const load = () => fetch(url + '/remote-api/load', { headers: { Cookie: cookie } }).then(response => response.json()) as Promise<any>;
    const first = await load(), second = await load();
    first.snapshot.db.projects[0].name = 'Phone edit';
    assert.equal((await post(url, 'save', cookie, first)).status, 200);
    second.snapshot.db.projects[0].name = 'Stale laptop edit';
    assert.equal((await post(url, 'save', cookie, second)).status, 409);
    assert.equal(shared.load()!.db.projects[0].name, 'Phone edit');
    const response = await post(url, 'chat', cookie, { provider: { apiKey: REMOTE_SECRET, baseUrl: 'https://example.test/v1', model: 'test-model' } });
    assert.equal(response.status, 200);
    assert.equal(calls[0].payload.provider.apiKey, 'sk-real-host-secret');
    assert.equal((await response.text()).includes('sk-real-host-secret'), false);
    const download = await post(url, 'original', cookie, {});
    assert.match(download.headers.get('content-disposition')!, /filename\*=UTF-8/);
    assert.equal(await download.text(), 'original');
  });
});

test('50 MB document boundary is accepted and larger declared uploads are rejected', async () => {
  await host(async (_web, _shared, url) => {
    const cookie = await login(url);
    const bytes = new Uint8Array(50 * 1024 * 1024);
    const response = await fetch(url + '/remote-api/document-import?name=资料.pdf', { method: 'POST',
      headers: { Cookie: cookie, Origin: url, 'X-Zhixu-Client': '1' }, body: bytes });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).size, bytes.length);
    const tooLarge = await fetch(url + '/remote-api/document-import?name=资料.pdf', { method: 'POST',
      headers: { Cookie: cookie, Origin: url, 'X-Zhixu-Client': '1' }, body: new Uint8Array(bytes.length + 1) });
    assert.equal(tooLarge.status, 413);
    const wrongFormat = await fetch(url + '/remote-api/document-import?name=program.exe', { method: 'POST',
      headers: { Cookie: cookie, Origin: url, 'X-Zhixu-Client': '1' }, body: new Uint8Array([1]) });
    assert.equal(wrongFormat.status, 400);
  });
});

test('public entry issues secure cookies, accepts only its host and revokes sessions', async () => {
  await host(async (web, _shared, url) => {
    web.setPublicURL('https://isolated-test.trycloudflare.com');
    const result = await customHost(url, '/remote-api/login', {
      Host: 'isolated-test.trycloudflare.com', Origin: 'https://isolated-test.trycloudflare.com', 'X-Zhixu-Client': '1'
    }, JSON.stringify({ password }));
    assert.equal(result.status, 200);
    assert.match(result.headers['set-cookie']![0], /HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
    const cookie = result.headers['set-cookie']![0].split(';')[0];
    web.clearPublicURL();
    assert.equal((await fetch(url + '/remote-api/load', { headers: { Cookie: cookie } })).status, 401);
    assert.throws(() => web.setPublicURL('http://evil.test'), /无效/);
  });
});

test('incorrect passwords are rate limited and not stored in password records', async () => {
  const record = await passwordHash(password);
  assert.equal(JSON.stringify(record).includes(password), false);
  await assert.rejects(passwordHash('short'), /12/);
  await host(async (_web, _shared, url) => {
    for (let index = 0; index < 16; index++) {
      const response = await post(url, 'login', '', { password: 'wrong' });
      assert.equal(response.status, index < 15 ? 401 : 429);
    }
  });
});
