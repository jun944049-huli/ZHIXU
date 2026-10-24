import { createHash } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { promisify } from 'node:util';
import { passwordHash, RemoteWeb, type RemoteWebOptions } from './remote-web';

const inputSchema = z.object({ operation: z.enum(['status', 'start', 'stop', 'password']),
  password: z.string().max(200).optional() });
const configSchema = z.object({ salt: z.string().regex(/^[a-f0-9]{48}$/), hash: z.string().regex(/^[a-f0-9]{128}$/) });
const runtimeSchema = z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), version: z.string().max(80) });
const execute = promisify(execFile);

export class RemoteAccess {
  private web?: RemoteWeb;
  private tunnel?: ChildProcess;
  private busy = false;
  private config?: z.infer<typeof configSchema>;
  private status = { running: false, url: '', localURL: '', message: '网页访问未开启', hasPassword: false };
  constructor(private readonly directory: string, private readonly options: Omit<RemoteWebOptions, 'password'>,
    private readonly systemFetch: (url: string, init?: RequestInit) => Promise<Response> = fetch) {}

  private async loadConfig() {
    if (this.config) return;
    try { this.config = configSchema.parse(JSON.parse(await readFile(join(this.directory, 'access.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('网页访问配置无法读取，请在桌面重新设置密码'); }
    this.status.hasPassword = !!this.config;
  }
  async handle(input: unknown) {
    const payload = inputSchema.parse(input);
    await this.loadConfig();
    if (payload.operation === 'status') return { ...this.status, busy: this.busy };
    if (this.busy) throw new Error('正在准备网页访问，请稍候');
    this.busy = true;
    try {
      if (payload.operation === 'stop') {
        await this.stop(); this.status.message = '网页访问已关闭，所有登录会话已失效';
      } else {
        if (payload.password) {
          const next = await passwordHash(payload.password);
          await this.stop();
          await mkdir(this.directory, { recursive: true });
          await writeFile(join(this.directory, 'access.json.tmp'), JSON.stringify(next), { mode: 0o600 });
          await rename(join(this.directory, 'access.json.tmp'), join(this.directory, 'access.json'));
          this.config = next; this.status.hasPassword = true;
        }
        if (payload.operation === 'password') {
          if (!payload.password) throw new Error('请填写新的访问密码');
          this.status.message = '密码已更新，原登录会话已失效，请重新开启网页访问';
        } else if (!this.status.running) {
          if (!this.config) throw new Error('请先设置至少 12 个字符的访问密码');
          if (!this.options.shared.load()) throw new Error('请先等待桌面工作数据保存完成');
          this.status.message = '正在校验并准备安全连接组件…';
          const executable = await this.runtime();
          this.web = new RemoteWeb({ ...this.options, password: this.config });
          this.status.localURL = await this.web.start();
          this.status.message = '正在建立 HTTPS 外网连接…';
          await this.connect(executable);
          this.status.running = true;
          this.status.message = '网页访问已开启。主机需保持知序运行、联网且不休眠。';
        }
      }
      return { ...this.status, busy: false };
    } catch (error) {
      await this.stop();
      this.status.message = error instanceof Error ? error.message : '网页访问启动失败';
      throw error;
    } finally { this.busy = false; }
  }

  async stop() {
    const process = this.tunnel;
    this.tunnel = undefined;
    if (process && process.exitCode === null) process.kill();
    await this.web?.stop(); this.web = undefined;
    this.status.running = false; this.status.url = ''; this.status.localURL = '';
  }

  private async runtime() {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前自动外网连接组件支持 Windows x64');
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'cloudflared.exe');
    try {
      const manifest = runtimeSchema.parse(JSON.parse(await readFile(join(this.directory, 'runtime.json'), 'utf8')));
      const digest = createHash('sha256').update(await readFile(path)).digest('hex');
      if ('sha256:' + digest === manifest.digest) return path;
    } catch { /* Download and verify an official release before executing it. */ }
    const release = await this.request('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Zhixu-Remote-Access' }, signal: AbortSignal.timeout(30000)
    }, response => response.json(), '安全连接组件信息获取') as any;
    const asset = release.assets?.find((item: any) => item.name === 'cloudflared-windows-amd64.exe');
    if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ||
        asset.size > 100 * 1024 * 1024 ||
        !String(asset.browser_download_url).startsWith('https://github.com/cloudflare/cloudflared/releases/download/')) {
      throw new Error('官方连接组件缺少有效校验信息，已停止安装');
    }
    const bytes = await this.request(asset.browser_download_url, {}, async download => {
      if (!download.body) throw new Error('下载响应为空');
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of download.body as any) {
        length += chunk.length;
        if (length > asset.size || length > 100 * 1024 * 1024) throw new Error('连接组件下载大小异常');
        chunks.push(chunk);
        this.status.message = `正在下载安全连接组件 ${Math.round(length / asset.size * 100)}%…`;
      }
      return Buffer.concat(chunks);
    }, '安全连接组件下载');
    if (bytes.length !== asset.size || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.digest) {
      throw new Error('安全连接组件校验失败，未运行下载文件，请重试');
    }
    await writeFile(path + '.tmp', bytes);
    await rename(path + '.tmp', path);
    await writeFile(join(this.directory, 'runtime.json'), JSON.stringify({ version: release.tag_name, digest: asset.digest }));
    return path;
  }

  private async request<T>(url: string, init: RequestInit, consume: (response: Response) => Promise<T>, stage: string): Promise<T> {
    let reason = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let response: Response;
        if (attempt === 0 && process.platform === 'win32') {
          // Windows curl respects an existing environment proxy; Chromium uses system proxy settings.
          const args = ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '20',
            '--max-time', '180', '--max-filesize', '104857600'];
          for (const [key, value] of Object.entries(init.headers || {})) args.push('--header', `${key}: ${value}`);
          args.push(url);
          const result = await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe'), args,
            { windowsHide: true, encoding: 'buffer', maxBuffer: 105 * 1024 * 1024, timeout: 185000 });
          response = new Response(new Uint8Array(result.stdout));
        } else {
          const request = attempt === 1 ? this.systemFetch : fetch;
          response = await request(url, { ...init, signal: AbortSignal.timeout(180000) });
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
        return await consume(response);
      } catch (error) {
        const failure = error as Error & { cause?: { code?: string } };
        reason = failure.cause?.code || (/curl\.exe/i.test(failure.message) ? '网络下载连接失败' : failure.message) || '网络不可用';
        this.status.message = `${stage}失败，正在重试（${attempt + 1}/3）…`;
      }
    }
    throw new Error(`${stage}失败：${reason.slice(0, 160)}。请检查 GitHub 网络连接或系统代理后重新开启。`);
  }

  private connect(executable: string) {
    return new Promise<void>((done, fail) => {
      const child = spawn(executable, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', this.status.localURL], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH,
          TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: this.directory,
          HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
          ALL_PROXY: process.env.ALL_PROXY, NO_PROXY: process.env.NO_PROXY }
      });
      this.tunnel = child;
      let buffer = '', settled = false;
      const timer = setTimeout(() => finish(new Error('外网连接超时，请检查网络是否允许访问 Cloudflare，再重新开启')), 90000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        error ? fail(error) : done();
      };
      const output = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString()).slice(-12000);
        const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buffer)?.[0];
        if (url && !this.status.url) {
          this.web!.setPublicURL(url);
          this.status.url = url;
        }
        if (this.status.url && /Registered tunnel connection/.test(buffer)) finish();
      };
      child.stdout?.on('data', output); child.stderr?.on('data', output);
      child.once('error', () => finish(new Error('安全连接组件无法启动，请检查系统权限或重新安装知序')));
      child.once('exit', code => {
        if (this.tunnel !== child) return;
        this.web?.clearPublicURL();
        this.status.running = false; this.status.url = '';
        this.status.message = `外网连接已断开（${code ?? '进程退出'}），请重新开启网页访问`;
        finish(new Error(this.status.message));
      });
    });
  }
}
