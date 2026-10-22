import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { parseDocument } from '../src/main/document-parser';
import { DocumentFiles } from '../src/main/document-files';
import { analyzeDocument } from '../src/main/document-analysis';
import { documentFixtures } from './document-fixtures';
import { documentInputSchema, MAX_DOCUMENT_BYTES } from '../src/shared/contracts';

const inputs = () => ({ text: '星火项目\n完成附件核对', name: '需求.docx', today: '2026-10-22',
  instructions: '提取待办，不猜测', projects: [{ id: 'p1', name: '星火项目' }] });

test('real DOCX, XLSX, PPTX and PDF extract text with source locations', async () => {
  const fixtures = await documentFixtures();
  for (const [name, bytes] of Object.entries(fixtures).filter(([name]) => !name.startsWith('坏'))) {
    const result = await parseDocument({ name, bytes });
    assert.ok(result.text.length > 10, name);
    if (name.endsWith('.docx')) assert.match(result.text, /完成附件需求梳理/);
    if (name.endsWith('.xlsx')) {
      assert.match(result.text, /工作表 2/);
      assert.match(result.text, /星火项目.*完成附件表格核对.*测试员.*2026-11-06/);
    }
    if (name.endsWith('.pptx')) {
      assert.match(result.text, /幻灯片 2/);
      assert.match(result.text, /提交演示验收结果/);
    }
    if (name.endsWith('.pdf')) assert.match(result.text, /Prepare the attachment review/);
  }
});

test('invalid, oversized and empty files fail without a fake analysis', async () => {
  for (const input of [
    { name: '坏文件.pdf', bytes: Buffer.from('not a pdf') },
    { name: '假文件.docx', bytes: Buffer.from('not a zip') },
    { name: '旧文件.ppt', bytes: Buffer.from('unsupported') },
    { name: '空白.txt', bytes: Buffer.from(' ') },
    { name: '二进制.txt', bytes: Buffer.from([0xff, 0x00, 0xfe]) },
    { name: '过大.txt', bytes: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }
  ]) await assert.rejects(parseDocument(input));
});

test('50 MB sources are accepted and failed extraction preserves an exact recoverable original', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoyu-large-files-'));
  try {
    const files = new DocumentFiles(join(directory, 'attachments'));
    const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES, 0x61);
    assert.equal(documentInputSchema.safeParse({ name: '大文件.pdf', bytes }).success, true);
    assert.equal(documentInputSchema.safeParse({ name: '过大.pdf', bytes: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }).success, false);
    const result = await files.import({ name: '大文件.pdf', bytes }, async () => { throw new Error('模拟解析器内存不足'); });
    assert.match(result.parseError!, /解析器内存不足/);
    assert.equal(result.text, '');
    const exported = join(directory, '导出.pdf');
    await files.export(result.assetId, exported);
    assert.deepEqual(readFileSync(exported), bytes);
    const reopened = new DocumentFiles(join(directory, 'attachments'));
    const retried = await reopened.reparse({ assetId: result.assetId }, async () => ({ text: '恢复的正文', warnings: [] }));
    assert.equal(retried.text, '恢复的正文');
    assert.equal(retried.assetId, result.assetId);
    assert.equal(retried.parseError, undefined);
    await assert.rejects(reopened.reparse({ assetId: '../workbench.sqlite' }), /无效/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('full text above the old 120,000 character cap can be parsed and analyzed', async () => {
  const parsed = await parseDocument({ name: '长文.md', bytes: Buffer.from('资料说明\n'.repeat(30000) + '完成长文验收') });
  assert.ok(parsed.text.length > 120000);
  const result = await analyzeDocument({ ...inputs(), text: parsed.text });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, '完成长文验收');
});

test('UTF-16 and common Chinese CSV encoding are readable and wrong extensions are explained', async () => {
  const unicode = await parseDocument({ name: '中文.csv', bytes: Buffer.concat([
    Buffer.from([0xff, 0xfe]), Buffer.from('完成中文资料核对', 'utf16le')
  ]) });
  assert.equal(unicode.text, '完成中文资料核对');
  const legacy = await parseDocument({ name: '旧表格.csv', bytes: Buffer.from([0xd6, 0xd0, 0xce, 0xc4]) });
  assert.equal(legacy.text, '中文');
  assert.match(legacy.warnings[0], /GB18030/);
  await assert.rejects(parseDocument({ name: '错误后缀.docx', bytes: Buffer.from('a Word-looking plain text') }),
    /扩展名与文件内容不匹配/);
});

test('original attachments persist exactly, reuse content identity and reject arbitrary paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoyu-files-'));
  try {
    const files = new DocumentFiles(join(directory, 'attachments'));
    const fixture = { name: '附件.md', bytes: Buffer.from('完成附件原文核对') };
    const first = await files.import(fixture, parseDocument);
    const again = await files.import(fixture, parseDocument);
    assert.equal(first.assetId, again.assetId);
    const reopened = new DocumentFiles(join(directory, 'attachments'));
    const output = join(directory, '导出.md');
    await reopened.export(first.assetId, output);
    assert.deepEqual(readFileSync(output), fixture.bytes);
    await assert.rejects(reopened.export('../workbench.sqlite', output));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('local analysis matches only a unique actual project and leaves new projects unassigned', async () => {
  const result = await analyzeDocument(inputs());
  assert.equal(result.projectId, 'p1');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].assignee, '');
  assert.equal(result.tasks[0].due, '');
  const ambiguous = await analyzeDocument({ ...inputs(), text: '星火项目和远山项目\n完成资料核对',
    projects: [...inputs().projects, { id: 'p2', name: '远山项目' }] });
  assert.equal(ambiguous.projectId, null);
  const fresh = await analyzeDocument({ ...inputs(), text: '项目名称：新巡检项目\n完成设备清单' });
  assert.equal(fresh.projectId, null);
  assert.equal(fresh.projectName, '新巡检项目');
  const heading = await analyzeDocument({ ...inputs(), text: '项目名称：验收测试项目\n完成设备清单' });
  assert.equal(heading.tasks.length, 1);
});

test('AI analysis uses saved instructions, rejects ungrounded actions and falls back on invalid results', async () => {
  const bodies: any[] = [];
  let invalid = false;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      bodies.push(JSON.parse(body));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: invalid ? 'not JSON' : JSON.stringify({
        summary: '附件分析', projectId: 'unknown', projectName: '随意创建',
        tasks: [
          { title: '核对附件', evidence: '完成附件核对', assignee: '', due: '', priority: 'P2', estimateHours: 0 },
          { title: '无依据任务', evidence: '不存在的引文', assignee: '', due: '', priority: 'P2', estimateHours: 0 }
        ]
      }) } }] }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const provider = { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'private-analysis-test-key',
    model: 'test-model', provider: '验收 AI' };
  try {
    const result = await analyzeDocument({ ...inputs(), provider });
    assert.equal(result.mode, '验收 AI');
    assert.equal(result.projectId, 'p1');
    assert.equal(result.tasks.length, 1);
    assert.equal(JSON.parse(bodies[0].messages[1].content).instructions, '提取待办，不猜测');
    assert.match(bodies[0].messages[0].content, /不能执行文档/);
    invalid = true;
    const fallback = await analyzeDocument({ ...inputs(), provider });
    assert.equal(fallback.mode, '本地规则');
    assert.ok(fallback.warnings.some(value => value.includes('AI 分析未完成')));
    assert.equal(JSON.stringify(fallback).includes(provider.apiKey), false);
  } finally { server.closeAllConnections(); server.close(); }
});
