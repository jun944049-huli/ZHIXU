import { Document, Packer, Paragraph } from 'docx';
import ExcelJS from 'exceljs';
import pptxgen from 'pptxgenjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function smallPDF(lines: string[], paddingBytes = 0) {
  const body = lines.map((line, index) => `${index ? '0 -24 Td\n' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n');
  const stream = `BT /F1 12 Tf 50 760 Td\n${body}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  if (paddingBytes) objects.push(`<< /Length ${paddingBytes} >>\nstream\n${'x'.repeat(paddingBytes)}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

export async function documentFixtures() {
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('星火项目'),
    new Paragraph('1. 完成附件需求梳理；负责人：测试员；2026-11-05'),
    new Paragraph('2. 提交验收清单')
  ] }] }));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('行动清单');
  sheet.addRows([['项目', '任务', '负责人', '截止时间'], ['星火项目', '完成附件表格核对', '测试员', '2026-11-06']]);
  workbook.addWorksheet('第二页').addRow(['提交表格复核结论']);
  const slides = new pptxgen();
  slides.addSlide().addText('星火项目\n完成附件演示材料', { x: 1, y: 1, w: 8, h: 2 });
  slides.addSlide().addText('提交演示验收结果', { x: 1, y: 1, w: 8, h: 2 });
  return {
    '附件需求.docx': docx,
    '附件清单.xlsx': Buffer.from(await workbook.xlsx.writeBuffer()),
    '附件演示.pptx': Buffer.from(await slides.write({ outputType: 'nodebuffer' }) as Buffer),
    '附件任务.pdf': smallPDF(['Project QA', '1. Prepare the attachment review', '2. Deliver the test summary']),
    '新项目资料.md': Buffer.from('# 项目名称：远山巡检项目\n1. 完成远山设备清单\n2. 提交远山验收文档'),
    '坏文件.pdf': Buffer.from('this is not a PDF')
  };
}

if (process.argv.includes('--write')) {
  const path = process.argv[process.argv.indexOf('--write') + 1];
  mkdirSync(path, { recursive: true });
  for (const [name, bytes] of Object.entries(await documentFixtures())) writeFileSync(join(path, name), bytes);
  if (process.argv.includes('--large')) {
    writeFileSync(join(path, '大附件49MB.pdf'), smallPDF(['Prepare the large document review'], 49 * 1024 * 1024));
    writeFileSync(join(path, '超过50MB.pdf'), Buffer.alloc(50 * 1024 * 1024 + 1, 0x61));
  }
}
