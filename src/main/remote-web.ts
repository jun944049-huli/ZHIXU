import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { MAX_DOCUMENT_BYTES } from '../shared/contracts';
import { remotePayload, remoteSnapshot, SharedWorkbench } from './remote-state';

const derive = promisify(scrypt);
export async function passwordHash(password: string, salt = randomBytes(24).toString('hex')) {
  if (password.length < 12 || password.length > 200) throw new Error('访问密码须为 12 至 200 个字符');
  return { salt, hash: (await derive(password, salt, 64) as Buffer).toString('hex') };
}

class HTTPError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function requestBody(request: IncomingMessage, limit: number) {
  if (Number(request.headers['content-length']) > limit) throw new HTTPError('请求过大，单个文件最多 50 MB', 413);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new HTTPError('请求过大，单个文件最多 50 MB', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const operations = new Set(['polish', 'chat', 'chat-summary', 'capture-task', 'provider-models', 'provider-diagnose',
  'document-reparse', 'document-analyze', 'integration']);
export interface RemoteWebOptions {
  assets: string;
  shared: SharedWorkbench;
  password: { salt: string; hash: string };
  invoke(operation: string, payload: unknown): Promise<unknown>;
  importDocument(name: string, bytes: Uint8Array): Promise<unknown>;
  download(operation: string, payload: unknown): Promise<{ bytes: Buffer; name: string }>;
}

export class RemoteWeb {
  private server?: Server;
  private sessions = new Map<string, number>();
  private attempts = new Map<string, { count: number; until: number }>();
  private active = 0;
  private publicHost = '';
  private localHost = '';
  constructor(private readonly options: RemoteWebOptions) {}

  setPublicURL(value: string) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)) throw new Error('无效的外网入口');
    this.publicHost = url.host;
  }
  clearPublicURL() { this.publicHost = ''; this.sessions.clear(); }

  async start(port = 0) {
    if (this.server) throw new Error('网页服务已启动');
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.requestTimeout = 240000;
    this.server.headersTimeout = 15000;
    this.server.maxHeadersCount = 50;
    await new Promise<void>((done, fail) => {
      this.server!.once('error', fail);
      this.server!.listen(port, '127.0.0.1', () => { this.server!.off('error', fail); done(); });
    });
    this.localHost = `127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return `http://${this.localHost}`;
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    this.sessions.clear(); this.attempts.clear(); this.publicHost = '';
    if (server) await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
  }

  private json(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  private limit(key: string, max: number) {
    const now = Date.now();
    if (this.attempts.size > 2000) for (const [id, entry] of this.attempts) if (entry.until < now) this.attempts.delete(id);
    if (this.attempts.size > 2000 && !this.attempts.has(key)) throw new HTTPError('请求过多，请稍后重试', 429);
    const entry = this.attempts.get(key);
    const next = entry && entry.until > now ? { ...entry, count: entry.count + 1 } : { count: 1, until: now + 600000 };
    this.attempts.set(key, next);
    if (next.count > max) throw new HTTPError('尝试次数过多，请 10 分钟后重试', 429);
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = request.headers.host || '';
      const isPublic = !!this.publicHost && host === this.publicHost;
      if (host !== this.localHost && !isPublic) throw new HTTPError('访问地址未获授权', 403);
      const origin = `${isPublic ? 'https' : 'http'}://${host}`;
      const url = new URL(request.url || '/', origin);
      if (request.headers.origin && request.headers.origin !== origin) throw new HTTPError('不允许跨站访问', 403);
      if (request.method === 'POST' && request.headers['sec-fetch-site'] === 'cross-site') throw new HTTPError('不允许跨站访问', 403);
      const mutation = request.method === 'POST';
      if (mutation && (request.headers.origin !== origin || request.headers['x-zhixu-client'] !== '1')) {
        throw new HTTPError('请求来源无效，请从知序页面重试', 403);
      }
      if (!['GET', 'POST'].includes(request.method || '')) throw new HTTPError('不支持此请求方式', 405);
      const path = url.pathname;
      if (!mutation && ['/login', '/remote-login.js', '/remote-login.css', '/brand/zhixu-c.svg'].includes(path)) {
        await this.asset(path === '/login' ? '/remote-login.html' : path, response);
        return;
      }
      if (path === '/remote-api/login' && mutation) {
        this.limit('login-global', 100);
        const ip = isPublic ? String(request.headers['cf-connecting-ip'] || 'unknown').slice(0, 80) : 'loopback';
        this.limit('login:' + ip, 15);
        const payload = JSON.parse((await requestBody(request, 2048)).toString());
        const candidate = typeof payload.password === 'string' && payload.password.length <= 200 ? payload.password : '';
        const expected = Buffer.from(this.options.password.hash, 'hex');
        const actual = await derive(candidate, this.options.password.salt, 64) as Buffer;
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HTTPError('访问密码不正确', 401);
        const now = Date.now();
        for (const [key, expiry] of this.sessions) if (expiry < now) this.sessions.delete(key);
        if (this.sessions.size >= 20) throw new HTTPError('登录设备过多，请在桌面关闭并重新开启网页访问', 429);
        const token = randomBytes(32).toString('base64url');
        this.sessions.set(createHash('sha256').update(token).digest('hex'), now + 12 * 3600000);
        response.setHeader('Set-Cookie', `zhixu_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${isPublic ? '; Secure' : ''}`);
        this.json(response, 200, { ok: true });
        return;
      }
      const cookie = /(?:^|;\s*)zhixu_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.cookie || '')?.[1] || '';
      const session = createHash('sha256').update(cookie).digest('hex');
      if ((this.sessions.get(session) || 0) <= Date.now()) {
        this.sessions.delete(session);
        if (!path.startsWith('/remote-api/') && !mutation) {
          response.writeHead(302, { Location: '/login' }); response.end(); return;
        }
        throw new HTTPError('请先登录知序，或重新登录已过期的会话', 401);
      }
      if (path === '/remote-api/logout' && mutation) {
        this.sessions.delete(session);
        response.setHeader('Set-Cookie', `zhixu_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isPublic ? '; Secure' : ''}`);
        this.json(response, 200, { ok: true }); return;
      }
      if (path === '/remote-api/revision' && !mutation) {
        this.json(response, 200, { revision: this.options.shared.revision }); return;
      }
      if (path === '/remote-api/load' && !mutation) {
        const snapshot = this.options.shared.load();
        if (!snapshot) throw new HTTPError('桌面工作台尚未准备好，请在主机打开知序后重试', 503);
        this.json(response, 200, { snapshot: remoteSnapshot(snapshot), revision: this.options.shared.revision }); return;
      }
      if (!path.startsWith('/remote-api/') && !mutation) {
        await this.asset(path === '/' ? '/index.html' : path, response); return;
      }
      if (!mutation) throw new HTTPError('接口不存在', 404);
      if (this.active >= 4) throw new HTTPError('正在处理其他请求，请稍候重试', 429);
      this.active++;
      try {
        const operation = path.slice('/remote-api/'.length);
        if (operation === 'document-import') {
          this.limit('upload:' + session, 120);
          const name = url.searchParams.get('name') || '';
          if (!name || name.length > 240 || !/\.(doc|docx|xlsx|pdf|pptx|txt|md|csv)$/i.test(name)) throw new HTTPError('不支持此文件格式', 400);
          const bytes = await requestBody(request, MAX_DOCUMENT_BYTES);
          this.json(response, 200, await this.options.importDocument(name, bytes)); return;
        }
        if (operation !== 'save' && !operations.has(operation) && !['export', 'original', 'backup'].includes(operation)) {
          throw new HTTPError('此功能未向网页端开放', 404);
        }
        const payload = JSON.parse((await requestBody(request, operation === 'save' ? 64_000_000 : 12_000_000)).toString() || '{}');
        if (operation === 'save') {
          const revision = this.options.shared.save(payload.snapshot, payload.revision, true);
          this.json(response, 200, { revision }); return;
        }
        if (['export', 'original', 'backup'].includes(operation)) {
          const result = await this.options.download(operation, payload);
          response.writeHead(200, { 'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="zhixu-download"; filename*=UTF-8''${encodeURIComponent(result.name).replace(/'/g, '%27')}` });
          response.end(result.bytes); return;
        }
        this.limit('model:' + session, 600);
        const current = this.options.shared.load();
        if (!current) throw new HTTPError('工作数据未准备好', 503);
        const result = await this.options.invoke(operation, remotePayload(operation, payload, current));
        this.json(response, 200, result);
      } finally { this.active--; }
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = (error as { status?: number }).status;
      this.json(response, status || 400, { message: error instanceof SyntaxError ? '请求内容无效，请刷新后重试' :
        (error as { name?: string }).name === 'ZodError' ? '请求内容不符合要求，请检查输入' :
          error instanceof Error ? error.message.slice(0, 1600) : '请求失败，请稍后重试' });
    }
  }

  private async asset(path: string, response: ServerResponse) {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('\\') || decoded.includes('\0')) throw new HTTPError('文件不存在', 404);
    const root = resolve(this.options.assets);
    const file = resolve(root, '.' + decoded);
    if (relative(root, file).startsWith('..') || !contentTypes[extname(file)]) throw new HTTPError('文件不存在', 404);
    let bytes: Buffer;
    try {
      const canonical = await realpath(file);
      if (relative(await realpath(root), canonical).startsWith('..')) throw new Error('Outside assets');
      bytes = await readFile(file);
    } catch { throw new HTTPError('文件不存在', 404); }
    if (decoded === '/index.html') {
      bytes = Buffer.from(bytes.toString().replace('<head>', '<head><script src="/remote-client.js"></script>'));
    }
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] });
    response.end(bytes);
  }
}
