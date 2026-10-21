import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { polish } from '../src/main/polish';

async function withProvider(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/v1`); }
  finally { server.closeAllConnections(); server.close(); }
}

test('custom provider receives the selected tone and returns compatible content', async () => {
  await withProvider((request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      const payload = JSON.parse(body);
      assert.equal(payload.messages[1].content, '明天 15:00 交付星火材料。');
      assert.match(payload.messages[0].content, /有说服力/);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ model: 'test-model', choices: [{ message: { content: '润色后的测试内容' } }] }));
    });
  }, async baseUrl => {
    assert.deepEqual(await polish({
      baseUrl, apiKey: 'test-key', model: 'test-model', tone: '有说服力',
      text: '明天 15:00 交付星火材料。', provider: '测试供应商'
    }), { text: '润色后的测试内容', model: 'test-model', provider: '测试供应商' });
  });
});

test('provider errors do not leak the supplied API key', async () => {
  await withProvider((_request, response) => {
    response.statusCode = 401;
    response.end('invalid private-test-key');
  }, async baseUrl => {
    await assert.rejects(polish({
      baseUrl, apiKey: 'private-test-key', model: 'test-model', text: '测试'
    }), error => {
      assert.match(String(error), /401/);
      assert.equal(String(error).includes('private-test-key'), false);
      return true;
    });
  });
});
