import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { documentInputSchema } from '../shared/contracts';

export async function parseInWorker(payload: unknown) {
  return new Promise<{ text: string; warnings: string[] }>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(join(import.meta.dirname, 'document-worker.js'), {
      workerData: payload, resourceLimits: { maxOldGenerationSizeMb: 512 }
    });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('解析超过 75 秒，请拆分文件后重试')); }, 75000);
    const finish = () => { clearTimeout(timer); void worker.terminate(); };
    worker.once('message', message => {
      settled = true;
      finish();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    });
    worker.once('error', () => { finish(); reject(new Error('文档解析进程失败，请拆分文件或另存后重试')); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`文档解析已停止（${code}），请拆分文件后重试`));
    });
  });
}

export class DocumentFiles {
  constructor(private readonly directory: string) {}

  async import(value: unknown, parse = parseInWorker) {
    const payload = documentInputSchema.parse(value);
    const parsed = await parse(payload);
    const bytes = Buffer.from(payload.bytes);
    const assetId = createHash('sha256').update(bytes).digest('hex') + extname(payload.name).toLowerCase();
    this.path(assetId);
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(this.path(assetId), bytes, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { ...parsed, assetId };
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
