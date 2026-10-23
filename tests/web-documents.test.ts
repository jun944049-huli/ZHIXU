import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { documentMiddleware } from '../src/web/documents';
import { documentFixtures } from './document-fixtures';
import { MAX_DOCUMENT_BYTES } from '../src/shared/contracts';

test('browser document service parses Office/PDF, preserves originals and rejects cross-site access', async () => {
  const middleware = documentMiddleware(mkdtempSync(join(tmpdir(), 'zhixu-web-documents-')));
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.writeHead(404); response.end(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/documents/`;
  try {
    for (const [name, bytes] of Object.entries(await documentFixtures())) {
      const response = await fetch(base + 'import?name=' + encodeURIComponent(name), { method: 'POST', body: new Uint8Array(bytes) });
      assert.equal(response.status, 200, name);
      const result = await response.json();
      assert.match(result.assetId, /^[a-f0-9]{64}\./);
      if (name.startsWith('坏')) assert.match(result.parseError, /不匹配/);
      else assert.ok(result.text.length > 10, name + ': missing real content');
      const original = await fetch(base + 'original?assetId=' + result.assetId);
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
      if (name.endsWith('.docx')) {
        const retry = await fetch(base + 'reparse', { method: 'POST', body: JSON.stringify({ assetId: result.assetId }) });
        assert.match((await retry.json()).text, /完成附件需求梳理/);
      }
    }
    const blocked = await fetch(base + 'import?name=reject.txt', {
      method: 'POST', body: 'test', headers: { Origin: 'https://untrusted.example' }
    });
    assert.equal(blocked.status, 403);
    assert.equal((await fetch(base + 'original?assetId=../workbench.sqlite')).status, 400);
    const oversized = await fetch(base + 'import?name=oversize.pdf', {
      method: 'POST', body: Buffer.alloc(MAX_DOCUMENT_BYTES + 1)
    });
    assert.equal(oversized.status, 413);
    assert.match((await oversized.json()).message, /50 MB/);
    const exact = await fetch(base + 'import?name=exact.pdf', {
      method: 'POST', body: Buffer.alloc(MAX_DOCUMENT_BYTES, 0x61)
    });
    assert.equal(exact.status, 200);
    assert.match((await exact.json()).parseError, /不匹配/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});
