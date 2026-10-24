import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { captureTask } from '../src/main/capture';

test('local capture removes conversational padding without inventing people or dropping related work', () => {
  const context = createContext({});
  runInContext(readFileSync('prototype/modals.js', 'utf8'), context);
  const title = (text: string) => runInContext(`deriveCaptureTitle(${JSON.stringify(text)})`, context);
  assert.equal(title('我要给青禾小学搬砖'), '为青禾小学搬砖');
  assert.equal(title('帮我把验收清单整理一下，发给小陈。'), '验收清单整理，发给小陈');
  assert.equal(title('客户说：整理联调问题并发给李经理。'), '整理联调问题并发给李经理');
  assert.equal(title('核对设备，预计 1 小时，然后提交验收清单。'), '核对设备，然后提交验收清单');
  assert.equal(title('星火项目：提交验收清单，今天完成。'), '提交验收清单');
  assert.equal(title('给小陈发邮件：说明验收安排。'), '给小陈发邮件：说明验收安排');
});

test('capture uses the configured provider and validates titles and errors', async () => {
  const key = 'sk-capture-isolated-test';
  let reply = '{"title":"整理验收清单并发给小陈"}', status = 200;
  let requestCount = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      requestCount++;
      assert.equal(request.headers.authorization, 'Bearer ' + key);
      const body = JSON.parse(raw);
      assert.equal(body.model, 'capture-model');
      assert.match(body.input[0].content, /不捏造人名/);
      assert.equal(raw.includes(key), false);
      const input = JSON.parse(body.input.at(-1).content);
      assert.equal(input.untrustedText, '我明天要把验收那份清单弄一下，然后发给小陈');
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(status === 200 ? JSON.stringify({
        model: 'actual-capture-model', status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }]
      }) : JSON.stringify({ error: { message: 'expired ' + key } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const input = {
      text: '我明天要把验收那份清单弄一下，然后发给小陈', projectName: '青禾小学',
      provider: { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: key, model: 'capture-model', protocol: 'responses' }
    };
    assert.deepEqual(await captureTask(input), { title: '整理验收清单并发给小陈', model: 'actual-capture-model' });
    for (const invalid of ['not-json', '{"title":""}', '{"title":"标题\\n另一条"}', JSON.stringify({ title: '字'.repeat(81) })]) {
      reply = invalid;
      await assert.rejects(captureTask(input), /有效的简短任务标题/);
    }
    status = 401;
    await assert.rejects(captureTask(input), (error: Error) => {
      assert.equal(error.message.includes(key), false);
      assert.match(error.message, /401|认证|密钥/);
      return true;
    });
    assert.equal(requestCount, 6);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
