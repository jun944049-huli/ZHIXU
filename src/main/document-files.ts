import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { documentInputSchema, type ImportedDocument } from '../shared/contracts';
import { z } from 'zod';

export async function parseInWorker(payload: unknown) {
  return new Promise<{ text: string; warnings: string[] }>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(join(import.meta.dirname, 'document-worker.js'), {
      workerData: payload, resourceLimits: { maxOldGenerationSizeMb: 1024 }
    });
    const timer = setTimeout(() => { settled = true; void worker.terminate(); reject(new Error('解析超过 180 秒，原文件已保留，可稍后重试解析或拆分文件')); }, 180000);
    const finish = () => { clearTimeout(timer); void worker.terminate(); };
    worker.once('message', message => {
      settled = true;
      finish();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    });
    worker.once('error', error => {
      settled = true;
      finish();
      const code = (error as NodeJS.ErrnoException).code || '';
      reject(new Error(code === 'ERR_WORKER_OUT_OF_MEMORY' ? '文档解析内存不足，请拆分文件后重试' :
        /MODULE_NOT_FOUND/.test(code) ? '桌面版本缺少文档解析组件，请更新当前小鱼程序后重试' :
          '文档解析进程启动或运行失败，请重新打开当前小鱼程序后重试；仍失败时请将文件另存为标准格式'));
    });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`文档解析已停止（${code}），请拆分文件后重试`));
    });
  });
}

export class DocumentFiles {
  constructor(private readonly directory: string) {}

  async import(value: unknown, parse = parseInWorker): Promise<ImportedDocument> {
    const payload = documentInputSchema.parse(value);
    const bytes = Buffer.from(payload.bytes);
    const assetId = createHash('sha256').update(bytes).digest('hex') + extname(payload.name).toLowerCase();
    this.path(assetId);
    try {
      await mkdir(this.directory, { recursive: true });
      try { await writeFile(this.path(assetId), bytes, { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new Error(code === 'ENOSPC' ? '原文件保存失败：磁盘空间不足，请释放空间后重试' :
        code === 'EACCES' || code === 'EPERM' ? '原文件保存失败：附件目录无写入权限或被安全软件阻止' :
          '原文件保存失败：附件目录不可写，请检查磁盘和目录权限后重试');
    }
    // Keep the source independently of parser support, memory and text limits.
    return this.parseSaved(payload, assetId, parse);
  }

  async reparse(value: unknown, parse = parseInWorker): Promise<ImportedDocument> {
    const { assetId } = z.object({ assetId: z.string().max(100) }).parse(value);
    const bytes = await readFile(this.path(assetId));
    if (createHash('sha256').update(bytes).digest('hex') !== assetId.split('.')[0]) {
      throw new Error('原附件校验失败，请从原始文件重新上传');
    }
    return this.parseSaved(documentInputSchema.parse({ name: assetId, bytes }), assetId, parse);
  }

  private async parseSaved(payload: z.infer<typeof documentInputSchema>, assetId: string,
    parse: (payload: unknown) => Promise<{ text: string; warnings: string[] }>): Promise<ImportedDocument> {
    try { return { ...await parse(payload), assetId }; }
    catch (error) {
      return { assetId, text: '', warnings: [],
        parseError: String(error instanceof Error ? error.message : '文档解析失败').slice(0, 1500) };
    }
  }

  private path(assetId: string) {
    if (!/^[a-f0-9]{64}\.(?:doc|docx|xlsx|pdf|pptx|txt|md|csv)$/.test(assetId)) throw new Error('无效的附件来源标识');
    return join(this.directory, assetId);
  }

  async export(assetId: string, destination: string) {
    const path = this.path(assetId);
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== assetId.split('.')[0]) throw new Error('原附件校验失败，请从原始文件重新上传');
    await copyFile(path, destination);
  }
}
