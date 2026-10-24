import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

test('loading an existing workbench does not write; real edits still persist and retain save failures', async () => {
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const snapshot = { db: { meta: { today }, projects: [{ id: 'p1', name: 'Existing' }] }, preferences: {} };
  const saved: unknown[] = [];
  let reject = false;
  const context = createContext({
    DB: structuredClone(snapshot.db), setTimeout, clearTimeout,
    window: { xiaoyuDesktop: { isRemote: true, load: async () => structuredClone(snapshot),
      save: async (value: unknown) => {
        if (reject) throw new Error('其他设备已更新');
        saved.push(value);
      } }, addEventListener() {} },
    document: { getElementById: () => null }, showToast() {}, workbenchSyncNotice() {}
  });
  runInContext(readFileSync(resolve('prototype/storage.js'), 'utf8'), context);
  await runInContext('initializeWorkbenchStorage()', context);
  await runInContext('persistWorkbench();', context);
  assert.equal(saved.length, 0);
  await runInContext("DB.projects[0].name='Edited'; persistWorkbench();", context);
  assert.equal(saved.length, 1);
  reject = true;
  await assert.rejects(runInContext("DB.projects[0].name='Unsaved edit'; persistWorkbench();", context), /其他设备已更新/);
  assert.equal(runInContext('DB.projects[0].name', context), 'Unsaved edit');
  assert.equal(saved.length, 1);
});

test('a delayed browser revision response cannot misidentify its own successful save as another device edit', async () => {
  let release!: (response: Response) => void;
  let hold = true;
  const context = createContext({
    window: {}, fetch: async (url: string) => {
      if (url.endsWith('/load')) return Response.json({ revision: 'one', snapshot: {} });
      if (url.endsWith('/save')) return Response.json({ revision: 'two' });
      if (hold) return new Promise<Response>(done => { release = done; });
      return Response.json({ revision: 'three' });
    }
  });
  runInContext(readFileSync(resolve('prototype/remote-client.js'), 'utf8'), context);
  await runInContext('window.xiaoyuDesktop.load()', context);
  const pending = runInContext('window.xiaoyuDesktop.revision()', context);
  await runInContext('window.xiaoyuDesktop.save({})', context);
  release(Response.json({ revision: 'one' }));
  assert.equal((await pending).changed, false);
  hold = false;
  assert.equal((await runInContext('window.xiaoyuDesktop.revision()', context)).changed, true);
});
