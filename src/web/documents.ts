import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Plugin } from 'vite';
import { DocumentFiles, parseInWorker } from '../main/document-files';
import { analyzeDocument } from '../main/document-analysis';
import { MAX_DOCUMENT_BYTES } from '../shared/contracts';

class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function body(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, exceeded = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (exceeded) return;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        reject(new RequestError('文件超过 50 MB，请压缩或拆分后上传', 413));
      } else chunks.push(chunk);
    });
    request.on('end', () => { if (!exceeded) resolveBody(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(new RequestError('上传已中断，请重新上传')));
  });
}

export function documentMiddleware(directory: string) {
  const files = new DocumentFiles(directory);
  const parse = (payload: unknown) => parseInWorker(payload, resolve('src/web/document-worker.cjs'));
  let busy = false;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/documents/')) { next(); return; }
    const json = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    let ownsBusy = false;
    try {
      // Only the local preview itself can read or write its attachment store.
      const host = request.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
          (request.headers.origin && request.headers.origin !== `http://${host}`) ||
          request.headers['sec-fetch-site'] === 'cross-site') throw new RequestError('仅允许本机工作台访问附件', 403);
      if (request.method === 'GET' && url.pathname === '/api/documents/original') {
        const bytes = await files.original(url.searchParams.get('assetId') || '');
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff' });
        response.end(bytes);
        return;
      }
      if (request.method !== 'POST') throw new RequestError('不支持的附件请求', 405);
      if (busy) throw new RequestError('正在处理另一份附件，请稍候再试', 409);
      busy = true; ownsBusy = true;
      if (Number(request.headers['content-length']) > MAX_DOCUMENT_BYTES) throw new RequestError('文件超过 50 MB，请压缩或拆分后上传', 413);
      if (url.pathname === '/api/documents/import') {
        const name = url.searchParams.get('name') || '';
        if (!name || name.length > 240 || !/\.(doc|docx|xlsx|pdf|pptx|txt|md|csv)$/i.test(name)) {
          throw new RequestError('格式不支持，请使用 DOC、DOCX、XLSX、PDF、PPTX 或文本文件');
        }
        const bytes = await body(request, MAX_DOCUMENT_BYTES);
        if (!bytes.length) throw new RequestError('文件为空，请选择包含正文的文件');
        json(200, await files.import({ name, bytes }, parse));
      } else if (url.pathname === '/api/documents/reparse') {
        json(200, await files.reparse(JSON.parse((await body(request, 4096)).toString()), parse));
      } else if (url.pathname === '/api/documents/analyze') {
        json(200, await analyzeDocument(JSON.parse((await body(request, 8 * 1024 * 1024)).toString())));
      } else throw new RequestError('附件接口不存在', 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : '附件处理失败，请重试';
      json(error instanceof RequestError ? error.status : 400, { message:
        error instanceof SyntaxError || (error as { name?: string }).name === 'ZodError'
          ? '附件请求内容无效，请重新选择文件后重试' : message });
    } finally { if (ownsBusy) busy = false; }
  };
}

export function webDocuments(): Plugin {
  return {
    name: 'zhixu-local-documents',
    configureServer(server) {
      server.middlewares.use(documentMiddleware(process.env.ZHIXU_WEB_DOCUMENT_DIR ||
        join(process.env.LOCALAPPDATA || homedir(), 'ZhixuWeb', 'attachments')));
    }
  };
}
