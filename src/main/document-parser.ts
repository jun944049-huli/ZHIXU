import { OfficeParser, type OfficeContentNode } from 'officeparser';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { documentInputSchema } from '../shared/contracts';

const documentRequire = createRequire(import.meta.url);

function nodeText(node: OfficeContentNode): string {
  if (node.type === 'row') return (node.children || []).map(nodeText).join(' | ');
  if (node.children?.length) return node.children.map(nodeText).join(
    ['cell', 'paragraph', 'heading', 'text'].includes(node.type) ? '' : '\n'
  );
  return node.text || '';
}

export async function parseDocument(value: unknown): Promise<{ text: string; warnings: string[] }> {
  const { name, bytes } = documentInputSchema.parse(value);
  const extension = extname(name).toLowerCase().slice(1);
  if (!['doc', 'docx', 'xlsx', 'pptx', 'pdf', 'txt', 'md', 'csv'].includes(extension)) {
    throw new Error('不支持此格式；旧版 XLS、PPT 请另存为 XLSX、PPTX');
  }
  let text = '';
  const warnings: string[] = [];
  try {
    if (['txt', 'md', 'csv'].includes(extension)) {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('BINARY_TEXT');
    } else if (extension === 'doc') {
      if (Buffer.from(bytes).subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new Error('CORRUPT_DOC');
      const WordExtractor = documentRequire('word-extractor') as new () => {
        extract(buffer: Buffer): Promise<{ getBody(): string; getHeaders(): string; getFootnotes(): string }>;
      };
      const doc = await new WordExtractor().extract(Buffer.from(bytes));
      text = [doc.getBody(), doc.getHeaders(), doc.getFootnotes()].filter(Boolean).join('\n');
    } else {
      const ast = await OfficeParser.parseOffice(Buffer.from(bytes), {
        fileType: extension as 'docx' | 'xlsx' | 'pptx' | 'pdf',
        extractAttachments: false, ocr: false, ignoreSlideMasters: true,
        abortSignal: AbortSignal.timeout(60000),
        pdfParserConfig: { separateProcess: false, extractTextColor: false, maxTimeMs: 50000 },
        decompressionLimits: { maxZipEntries: 5000, maxUncompressedBytes: 80 * 1024 * 1024,
          maxTableCells: 100000, maxXmlElements: 300000 },
        onWarning: () => {}
      });
      // Label source locations so the analysis and task excerpts remain traceable.
      if (['xlsx', 'pptx', 'pdf'].includes(extension)) {
        text = ast.content.map((node, index) => {
          const label = extension === 'xlsx' ? `工作表 ${index + 1}` : extension === 'pptx' ? `幻灯片 ${index + 1}` : `第 ${index + 1} 页`;
          return `[${label}]\n${nodeText(node)}`;
        }).join('\n\n');
      } else text = String((await ast.to('text')).value);
      if (ast.warnings.some(issue => /LIMIT_EXCEEDED|CONTENT_PART_NOT_READ|PAGE_LOAD_FAILED/.test(issue.code))) {
        throw new Error('PARTIAL_DOCUMENT');
      }
      if (ast.warnings.some(issue => issue.code === 'PDF_NO_TEXT_EXTRACTED')) throw new Error('NO_PDF_TEXT');
      if (ast.warnings.length) warnings.push('部分版式、图表或嵌入内容可能未提取，请对照原文件核查。');
    }
  } catch (error) {
    const message = String(error);
    if (/PARTIAL_DOCUMENT/.test(message)) throw new Error('文档超出解析限制或部分页面无法读取，请拆分后上传');
    if (/NO_PDF_TEXT/.test(message)) throw new Error('PDF 没有可读文本层，请先 OCR 后上传');
    if (/PASSWORD|encrypted|password/i.test(message)) throw new Error('文件已加密，请先去除密码后上传');
    throw new Error('文件无法解析，请检查是否损坏或另存为标准格式；文本文件须使用 UTF-8');
  }
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text || !text.replace(/\[(?:第 \d+ 页|幻灯片 \d+|工作表 \d+)\]/g, '').trim()) {
    throw new Error('没有提取到可分析正文；扫描件或图片需要先 OCR');
  }
  if (text.length > 120000) throw new Error('单份文档正文超过 12 万字，请拆分文件后上传');
  return { text, warnings };
}
