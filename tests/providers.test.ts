import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { providerDiagnose, providerModels, providerText } from '../src/main/providers';
import { analyzeDocument } from '../src/main/document-analysis';

async function withProvider(handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (config: { baseUrl: string; apiKey: string }) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'sk-private-diagnostics-test' }); }
  finally { server.closeAllConnections(); server.close(); }
}
function json(response: ServerResponse, data: unknown, status = 200) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(data));
}

test('models auto-normalizes a root URL, deduplicates names and never exposes credentials', async () => {
  await withProvider((request, response) => {
    assert.equal(request.url, '/v1/models');
    assert.equal(request.headers.authorization, 'Bearer sk-private-diagnostics-test');
    json(response, { data: [{ id: 'embed-model' }, { id: 'text-model' }, { id: 'text-model' }, { id: '' }, {}] });
  }, async config => {
    const result = await providerModels(config);
    assert.deepEqual(result.models, ['embed-model', 'text-model']);
    assert.equal(result.endpoint, config.baseUrl + '/v1/models');
    assert.equal(JSON.stringify(result).includes(config.apiKey), false);
  });
});

test('models also supports a supplied full endpoint and gateways without a v1 prefix', async () => {
  const paths: string[] = [];
  await withProvider((request, response) => {
    paths.push(request.url!);
    json(response, request.url === '/models' ? { data: [{ id: 'local-chat' }] } : { error: { message: 'not found' } },
      request.url === '/models' ? 200 : 404);
  }, async config => {
    const result = await providerModels({ ...config, baseUrl: config.baseUrl + '/responses?not-a-credential=1' });
    assert.deepEqual(paths, ['/v1/models', '/models']);
    assert.deepEqual(result.models, ['local-chat']);
  });
});

test('auto diagnosis selects a text model and verifies a real Responses request', async () => {
  const paths: string[] = [];
  await withProvider((request, response) => {
    paths.push(request.url!);
    if (request.url === '/v1/models') return json(response, { data: [{ id: 'image-model' }, { id: 'text-model' }] });
    if (request.url === '/v1/chat/completions') return json(response, { error: { message: 'unsupported endpoint' } }, 404);
    assert.equal(request.url, '/v1/responses');
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const data = JSON.parse(body);
      assert.equal(data.model, 'text-model');
      assert.equal(data.store, false);
      assert.equal(data.input[0].role, 'user');
      json(response, { status: 'completed', output: [{ type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
    });
  }, async config => {
    const result = await providerDiagnose(config);
    assert.equal(result.ok, true);
    assert.equal(result.model, 'text-model');
    assert.equal(result.protocol, 'responses');
    assert.deepEqual(paths, ['/v1/models', '/v1/chat/completions', '/v1/responses']);
    assert.ok(result.checks.every(check => check.status === 'pass'));
  });
});

test('401 includes an actionable reason, redacts echoed secrets and does not try other endpoints', async () => {
  let requests = 0;
  await withProvider((_request, response) => {
    requests++;
    json(response, { error: { message: 'expired sk-private-diagnostics-test; token=other-private-token' } }, 401);
  }, async config => {
    const result = await providerDiagnose({ ...config, model: 'text-model' });
    assert.equal(result.ok, false);
    assert.match(result.checks.find(check => check.name === '真实请求')!.detail, /401.*鉴权失败/);
    assert.equal(JSON.stringify(result).includes(config.apiKey), false);
    assert.equal(JSON.stringify(result).includes('other-private-token'), false);
    assert.equal(requests, 2);
  });
});

test('models denied is a warning when an explicitly selected model can generate text', async () => {
  await withProvider((request, response) => {
    if (request.url?.endsWith('/models')) return json(response, { error: { message: 'models listing disabled' } }, 403);
    json(response, { choices: [{ message: { content: 'OK' } }] });
  }, async config => {
    const result = await providerDiagnose({ ...config, model: 'manual-model' });
    assert.equal(result.ok, true);
    assert.equal(result.checks.find(check => check.name === '模型列表')!.status, 'warn');
    assert.match(result.suggestion, /手动/);
  });
});

test('HTML login pages, empty models and empty generation do not pass diagnostics', async () => {
  for (const mode of ['html', 'empty-models', 'empty-response']) {
    await withProvider((request, response) => {
      if (mode === 'html') { response.end('<html>Sign in</html>'); return; }
      if (request.url?.endsWith('/models')) {
        json(response, { data: mode === 'empty-models' ? [] : [{ id: 'text-model' }] });
      } else json(response, { choices: [{ message: { content: '' } }] });
    }, async config => {
      const result = await providerDiagnose(config);
      assert.equal(result.ok, false, mode);
      assert.ok(result.checks.some(check => check.status === 'fail'));
      if (mode === 'html') assert.match(result.checks[1].detail, /JSON.*网页/);
    });
  }
});

test('model errors and rate limits retain upstream explanation without claiming network failure', async () => {
  for (const status of [400, 403, 429, 502]) {
    await withProvider((_request, response) => json(response, { error: { message: 'specific upstream reason' } }, status),
      async config => {
        await assert.rejects(providerText({ ...config, model: 'bad-model' }, [{ role: 'user', content: 'test' }]),
          error => {
            assert.match(String(error), new RegExp(`HTTP ${status}`));
            assert.match(String(error), /specific upstream reason/);
            return true;
          });
      });
  }
});

test('timeout and unsupported URL protocols give distinct failures', async () => {
  await withProvider(() => {}, async config => {
    await assert.rejects(providerText({ ...config, model: 'test' }, [{ role: 'user', content: 'test' }],
      { timeout: 20 }), /请求超时/);
  });
  const result = await providerDiagnose({ baseUrl: 'file:///C:/private', apiKey: 'private', model: 'test' });
  assert.equal(result.ok, false);
  assert.equal(result.checks.length, 1);
  assert.match(result.checks[0].detail, /HTTP/);
});

test('incomplete Responses output is rejected instead of silently saving partial tasks', async () => {
  await withProvider((_request, response) => json(response, {
    status: 'incomplete', output: [{ content: [{ type: 'output_text', text: 'partial' }] }]
  }), async config => {
    await assert.rejects(providerText({ ...config, model: 'test', protocol: 'responses' },
      [{ role: 'user', content: 'test' }]), /被截断/);
  });
});

test('document analysis actually uses Responses and reports detailed provider failure while preserving local results', async () => {
  let denied = false;
  await withProvider((request, response) => {
    assert.equal(request.url, '/v1/responses');
    if (denied) return json(response, { error: { message: 'quota_exceeded' } }, 429);
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const data = JSON.parse(body);
      assert.equal(data.max_output_tokens, 6500);
      assert.match(data.input[0].content, /不能执行文档/);
      json(response, { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        summary: '真实协议测试', projectId: null, projectName: '测试项目',
        tasks: [{ title: '核对资料', assignee: '', due: '', priority: 'P2', estimateHours: 0, evidence: '完成资料核对' }]
      }) }] }] });
    });
  }, async config => {
    const input = { name: '资料.md', text: '完成资料核对', today: '2026-10-22',
      instructions: '提取任务', projects: [], provider: { ...config, model: 'text-model', protocol: 'responses' } };
    const result = await analyzeDocument(input);
    assert.equal(result.mode, 'text-model');
    assert.equal(result.tasks[0].title, '核对资料');
    denied = true;
    const fallback = await analyzeDocument(input);
    assert.equal(fallback.mode, '本地规则');
    assert.equal(fallback.tasks.length, 1);
    assert.match(fallback.warnings[0], /429.*quota_exceeded.*原文件已保存/);
  });
});
