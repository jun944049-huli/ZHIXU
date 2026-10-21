import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { csvText, exportBuffer, reportHTML } from '../src/main/exports';

test('spreadsheet exports preserve Unicode as text and neutralize CSV formulas', async () => {
  const rows = [['标题', '值'], ['验收内容', '=SUM(1,2)'], ['换行', '第一行\n第二行']];
  assert.match(csvText(rows), /"'=SUM\(1,2\)"/);
  const buffer = await exportBuffer({ format: 'xlsx', title: '验收', text: '', rows });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  assert.equal(workbook.getWorksheet('报表')!.getCell('B2').value, '=SUM(1,2)');
  assert.equal(workbook.getWorksheet('报表')!.getCell('B3').value, '第一行\n第二行');
});

test('DOCX exports are genuine OpenXML files and PDF HTML escapes active content', async () => {
  const buffer = await exportBuffer({ format: 'docx', title: '验收', text: '中文日报\n已完成验收' });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1000);
  const html = reportHTML('标题', '<script>alert("x")</script>');
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /default-src 'none'/);
});
