import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { UpdateHttpExecutor, updateProxy } from '../src/main/update-http';
import type { ClientRequest } from 'electron';

test('update connections use system settings or the existing environment proxy', () => {
  assert.deepEqual(updateProxy({}), { mode: 'system' });
  assert.deepEqual(updateProxy({ HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: 'localhost,127.0.0.1' }), {
    proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: '<local>;localhost;127.0.0.1'
  });
  assert.match(updateProxy({ https_proxy: 'socks5://localhost:1080' }).proxyRules!, /^socks5:/);
  assert.throws(() => updateProxy({ HTTPS_PROXY: 'file:///etc/proxy' }), /代理配置/);
  assert.throws(() => updateProxy({ HTTPS_PROXY: 'https://user:secret@localhost:1080' }), /代理配置/);
});
function request() {
  const connection = Object.assign(new EventEmitter(), { aborted: false });
  return Object.assign(connection, { abort() { connection.aborted = true; connection.emit('abort'); } });
}
test('a request without an Electron response times out and aborts', async () => {
  const connection = request();
  let error = '';
  new UpdateHttpExecutor(15).addErrorAndTimeoutHandlers(connection as unknown as ClientRequest, value => { error = value.message; });
  connection.emit('close');
  await delay(40);
  assert.equal(connection.aborted, true); assert.match(error, /ETIMEDOUT/);
});
test('a response that stalls midway times out while completed responses do not', async () => {
  const executor = new UpdateHttpExecutor(15);
  const connection = request(), response = new EventEmitter();
  let error = '';
  executor.addErrorAndTimeoutHandlers(connection as unknown as ClientRequest, value => { error = value.message; });
  connection.emit('response', response); response.emit('data', Buffer.from('partial'));
  await delay(40);
  assert.equal(connection.aborted, true); assert.match(error, /ETIMEDOUT/);
  const complete = request(), body = new EventEmitter();
  executor.addErrorAndTimeoutHandlers(complete as unknown as ClientRequest, () => assert.fail('Completed response timed out'));
  complete.emit('response', body); body.emit('data', Buffer.from('complete')); body.emit('end');
  await delay(40); assert.equal(complete.aborted, false);
});
