import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkbenchStore, type SettingsCodec } from '../src/main/database';
import type { WorkbenchSnapshot } from '../src/shared/contracts';

const codec: SettingsCodec = {
  encrypt: value => Buffer.from(value).toString('base64'),
  decrypt: value => Buffer.from(value, 'base64').toString()
};

function fixture(): WorkbenchSnapshot {
  return {
    db: {
      meta: { today: '2026-10-22' },
      projects: [{ id: 'p1', name: '测试项目' }],
      tasks: {
        must: [{ id: 't1', title: '准备演示', project: 'p1', done: true }],
        should: [], could: []
      },
      inbox: [{ id: 'i1', title: '待确认消息' }],
      settings: {
        assistantName: '小鱼', deepseekKey: 'test-secret-key',
        integrations: { mail: { password: 'private-imap-password' }, ics: { url: 'https://example.com/private-feed' } }
      }
    },
    preferences: { 'jw-settings': '{"deepseekKey":"test-secret-key"}' }
  };
}

function withStore(run: (store: WorkbenchStore, path: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoyu-database-test-'));
  const path = join(directory, 'test.sqlite');
  const store = new WorkbenchStore(path, codec);
  try { run(store, path); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('completed tasks, original settings and inbox survive a database reopen', () => {
  withStore((store, path) => {
    const original = fixture();
    store.save(original);
    const reopened = new WorkbenchStore(path, codec);
    try { assert.deepEqual(reopened.load(), original); }
    finally { reopened.close(); }
    const disk = readFileSync(path).toString();
    assert.equal(disk.includes('test-secret-key'), false);
    assert.equal(readFileSync(path + '-wal').toString().includes('test-secret-key'), false);
    for (const secret of ['private-imap-password', 'private-feed']) {
      assert.equal(disk.includes(secret), false);
      assert.equal(readFileSync(path + '-wal').toString().includes(secret), false);
    }
  });
});

test('invalid snapshots cannot replace the last valid data', () => {
  withStore(store => {
    store.save(fixture());
    assert.throws(() => store.save({ db: { projects: [] } }));
    assert.deepEqual(store.load(), fixture());
  });
});

test('document text beyond the old 8 MB snapshot cap survives reopening', () => {
  withStore((store, path) => {
    const snapshot = fixture();
    snapshot.db.documents = [{ id: 'large-text', content: '测'.repeat(3_000_000) }];
    store.save(snapshot);
    const reopened = new WorkbenchStore(path, codec);
    try { assert.equal((reopened.load()!.db.documents as { content: string }[])[0].content.length, 3_000_000); }
    finally { reopened.close(); }
    const oversized = fixture();
    oversized.db.documents = [{ content: 'x'.repeat(64_000_001) }];
    assert.throws(() => store.save(oversized), /64|过大|容量|上限/);
    assert.equal((store.load()!.db.documents as { content: string }[])[0].content.length, 3_000_000);
  });
});

test('projection errors roll back the full snapshot and all task changes', () => {
  withStore(store => {
    store.save(fixture());
    const broken = fixture();
    broken.db.projects.push({ id: 'p1', name: '重复项目' });
    broken.db.tasks.must[0].done = false;
    assert.throws(() => store.save(broken));
    assert.deepEqual(store.load(), fixture());
  });
});

test('unavailable system encryption does not erase existing work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoyu-encryption-test-'));
  const store = new WorkbenchStore(join(directory, 'test.sqlite'), {
    encrypt() { throw new Error('encryption unavailable'); },
    decrypt: value => value
  });
  try {
    assert.throws(() => store.save(fixture()), /encryption unavailable/);
    assert.equal(store.load(), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
