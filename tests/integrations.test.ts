import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { ImapFlow } from 'imapflow';
import { runIntegration } from '../src/main/integrations';

const response = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' }
});

test('Feishu verifies application and chat permissions and imports readable messages', async () => {
  const calls: string[] = [];
  const result = await runIntegration({
    id: 'feishu', operation: 'sync',
    config: { appId: 'app', appSecret: 'private-secret', chatId: 'chat' }
  }, {
    fetch: async (url, init) => {
      calls.push(url);
      if (url.includes('/auth/')) {
        assert.equal(JSON.parse(String(init?.body)).app_secret, 'private-secret');
        return response({ code: 0, tenant_access_token: 'private-token' });
      }
      assert.equal(new URL(url).searchParams.get('container_id'), 'chat');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-token');
      return response({ code: 0, data: { items: [
        { message_id: 'm1', msg_type: 'text', body: { content: '{"text":"明天交付验收材料"}' } },
        { message_id: 'm2', deleted: true, body: { content: '已删除' } }
      ] } });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.mode, 'read');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].raw, '明天交付验收材料');
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('DingTalk and WeCom verify credentials without pretending to receive chat', async () => {
  for (const id of ['dingtalk', 'wecom'] as const) {
    const config = id === 'dingtalk'
      ? { appKey: 'app', appSecret: 'secret' }
      : { corpId: 'corp', corpSecret: 'secret' };
    const result = await runIntegration({ id, operation: 'test', config }, {
      fetch: async url => {
        assert.ok(url.startsWith(id === 'dingtalk' ? 'https://api.dingtalk.com/' : 'https://qyapi.weixin.qq.com/'));
        return response(id === 'dingtalk' ? { accessToken: 'token' } : { errcode: 0, access_token: 'token' });
      }
    });
    assert.equal(result.mode, 'auth');
    assert.match(result.message, /消息接收尚未接入/);
    await assert.rejects(runIntegration({ id, operation: 'sync', config }), /消息接收尚未接入/);
  }
});

test('provider failures report codes without echoing credentials or returned secrets', async () => {
  await assert.rejects(runIntegration({
    id: 'wecom', operation: 'test', config: { corpId: 'corp', corpSecret: 'private-secret' }
  }, { fetch: async () => response({ errcode: 60020, errmsg: 'private-secret private-token' }) }), error => {
    assert.match(String(error), /60020/);
    assert.equal(String(error).includes('private-'), false);
    return true;
  });
  await assert.rejects(runIntegration({
    id: 'ics', operation: 'test', config: { url: 'https://example.com/feed?token=private-token' }
  }, { fetch: async () => { throw new Error('URL contains private-token'); } }), error => {
    assert.equal(String(error).includes('private-token'), false);
    return true;
  });
});

test('ICS reads an actual HTTP feed, expands recurrences, respects exclusions, and returns stable IDs', async () => {
  const server = createServer((_request, reply) => {
    reply.setHeader('Content-Type', 'text/calendar');
    reply.end([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:recurring',
      'DTSTART:20261023T020000Z', 'DTEND:20261023T030000Z',
      'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE:20261024T020000Z',
      'SUMMARY:验收会议', 'DESCRIPTION:保留原始日程说明', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:old', 'DTSTART:20251023T020000Z', 'SUMMARY:过去日程', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const payload = {
    id: 'ics', operation: 'sync', config: { url: `http://127.0.0.1:${address.port}/feed?token=private-token` }
  };
  try {
    const options = { now: new Date('2026-10-22T12:00:00Z') };
    const first = await runIntegration(payload, options);
    const second = await runIntegration(payload, options);
    assert.equal(first.records.length, 2);
    assert.equal(first.records[0].title, '验收会议');
    assert.match(first.records[0].raw, /保留原始日程说明/);
    assert.deepEqual(first.records, second.records);
    assert.equal(JSON.stringify(first).includes('private-token'), false);
    assert.deepEqual((await runIntegration({ ...payload, operation: 'test' }, options)).records, []);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('ICS rejects HTML login pages, oversized feeds, unsafe protocols, and excessive recurrence', async () => {
  for (const body of ['<html>Login required</html>', 'x'.repeat(2_000_001)]) {
    await assert.rejects(runIntegration({
      id: 'ics', operation: 'test', config: { url: 'https://example.com/feed' }
    }, { fetch: async () => new Response(body) }), /ICS|2 MB/);
  }
  await assert.rejects(runIntegration({
    id: 'ics', operation: 'test', config: { url: 'file:///C:/private.txt' }
  }), /HTTP/);
  await assert.rejects(runIntegration({
    id: 'ics', operation: 'sync', config: { url: 'https://example.com/feed' }
  }, { fetch: async () => new Response([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:too-frequent',
    'DTSTART:20261023T020000Z', 'RRULE:FREQ=MINUTELY',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n')) }), /按秒或按分钟/);
});

test('IMAP uses TLS and a read-only mailbox, decodes MIME, and preserves message identity', async () => {
  let released = false;
  let loggedOut = false;
  const result = await runIntegration({
    id: 'mail', operation: 'sync',
    config: { host: 'imap.example.com', port: '993', user: 'user@example.com', password: 'private-pass', folder: 'INBOX' }
  }, {
    createMailbox: options => {
      assert.equal(options.secure, true);
      assert.equal(options.auth?.pass, 'private-pass');
      return {
        on() {}, connect: async () => {}, mailbox: { exists: 1, uidValidity: 99n },
        getMailboxLock: async (folder: string, flags: { readOnly: boolean }) => {
          assert.equal(folder, 'INBOX');
          assert.equal(flags.readOnly, true);
          return { release: () => { released = true; } };
        },
        fetchAll: async () => [{ uid: 12, size: 150, envelope: { subject: '验收邮件', from: [{ address: 'sender@example.com' }] } }],
        fetchOne: async (_uid: string, query: object) => {
          assert.deepEqual(query, { source: { start: 0, maxLength: 256000 } });
          return { source: Buffer.from('Subject: Test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n明天提交验收材料') };
        },
        logout: async () => { loggedOut = true; }, close() {}
      } as unknown as ImapFlow;
    }
  });
  assert.equal(result.records.length, 1);
  assert.match(result.records[0].raw, /明天提交验收材料/);
  assert.match(result.records[0].externalId, /:99:12$/);
  assert.equal(JSON.stringify(result).includes('private-pass'), false);
  assert.equal(released && loggedOut, true);
});
