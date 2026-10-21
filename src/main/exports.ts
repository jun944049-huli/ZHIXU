import { Document, Packer, Paragraph } from 'docx';
import ExcelJS from 'exceljs';
import { z } from 'zod';

export const exportSchema = z.object({
  format: z.enum(['md', 'csv', 'json', 'docx', 'xlsx', 'pdf']),
  title: z.string().min(1).max(150),
  text: z.string().max(8_000_000),
  rows: z.array(z.array(z.string().max(12000))).max(50000).optional()
});

export function csvText(rows: string[][]) {
  return '\ufeff' + rows.map(row => row.map(cell => {
    // Prevent spreadsheet applications from interpreting imported text as formulas.
    const value = /^[=+\-@\t\r]/.test(cell) ? "'" + cell : cell;
    return '"' + value.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}

export async function exportBuffer(input: z.infer<typeof exportSchema>): Promise<Buffer> {
  if (input.format === 'docx') {
    const document = new Document({ sections: [{ children: input.text.split('\n').map(text => new Paragraph({ text })) }] });
    return Packer.toBuffer(document);
  }
  if (input.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('报表');
    const rows = input.rows?.length ? input.rows : input.text.split('\n').map(line => [line]);
    rows.forEach(row => sheet.addRow(row));
    sheet.columns.forEach(column => { column.width = 38; column.alignment = { wrapText: true, vertical: 'top' }; });
    sheet.getRow(1).font = { bold: true };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  return Buffer.from(input.format === 'csv' ? csvText(input.rows || []) : input.text);
}

export function reportHTML(title: string, text: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]!);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>${escape(title)}</title><style>body{font:13px/1.7 'Microsoft YaHei',sans-serif;color:#222;padding:24px}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}h1{font-size:22px}</style>
    <h1>${escape(title)}</h1><pre>${escape(text)}</pre></html>`;
}
