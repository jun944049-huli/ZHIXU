import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../prototype/chat-format.js';

test('chat envelopes handle fences, commentary and double encoding without leaking protocol fields', () => {
  const output = { reply: '维修已完成。\n\n- 设备部署：进行中\n- 验收：待开始', actions: [] };
  for (const text of [JSON.stringify(output), '```json\n' + JSON.stringify(output) + '\n```',
    '处理结果如下：\n' + JSON.stringify(output), JSON.stringify(JSON.stringify(output)),
    '处理结果如下：\n' + JSON.stringify(JSON.stringify(output))]) {
    const result = ZhixuChatFormatting.parse(text);
    assert.equal(result.reply, output.reply);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.warnings, []);
  }
});

test('malformed envelopes recover readable replies without executing recovered actions', () => {
  const broken = '{"reply":"维修完成。\\n设备部署仍在进行。","actions":[{"type":"work_update",}]}';
  const result = ZhixuChatFormatting.parse(broken);
  assert.equal(result.reply, '维修完成。\n设备部署仍在进行。');
  assert.deepEqual(result.actions, []);
  assert.match(result.warnings.join(''), /未执行/);
  assert.equal(ZhixuChatFormatting.display('明白，情况如下：\\n- 维修：完成\\n- 部署：进行中。", "actions":[]}'),
    '明白，情况如下：\n- 维修：完成\n- 部署：进行中。');
  assert.throws(() => ZhixuChatFormatting.parse('{"reply":"被截断'), /结构不完整/);
});

test('plain replies and code retain paths, quotes and markup as text', () => {
  assert.equal(ZhixuChatFormatting.display('路径是 `C:\\new\\notes`。'), '路径是 `C:\\new\\notes`。');
  assert.equal(ZhixuChatFormatting.parse('普通问答。').reply, '普通问答。');
  assert.equal(ZhixuChatFormatting.parse('<script>test</script>').reply, '<script>test</script>');
});
