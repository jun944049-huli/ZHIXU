import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { UpdateStatus } from '../shared/updates';

export const UPDATE_REPOSITORY = { provider: 'github' as const, owner: 'jun944049-huli', repo: 'ZHIXU', private: true };
export interface UpdateEngine extends EventEmitter {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent?: boolean, runAfter?: boolean): void;
}
export class UpdatePreparationError extends Error {}
interface Dependencies {
  version: string;
  packaged: boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
  credential(): Promise<string>;
  engine(token: string): UpdateEngine | Promise<UpdateEngine>;
  prepare(): Promise<void>;
  notify(status: UpdateStatus): void;
}

// Read an existing login without opening a Git credential prompt or writing credentials.
export function githubCredential(): Promise<string> {
  return new Promise(resolve => {
    const child = execFile('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
      windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024,
      env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' }
    }, (error, stdout) => {
      if (error) { resolve(''); return; }
      resolve(stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9).trim() || '');
    });
    child.stdin?.end('protocol=https\nhost=github.com\nusername=jun944049-huli\n\n');
  });
}

export function updateError(error: unknown): string {
  const text = String(error);
  if (/ETIMEDOUT|timed out|connection stalled/i.test(text)) {
    return '更新连接超时，已停止等待。请检查网络或代理后重新检查更新，当前版本可以继续使用。';
  }
  if (/更新代理配置无效/i.test(text)) return '更新代理配置无效，请检查系统代理或 HTTPS_PROXY 设置后重试。';
  if (/CHANNEL_FILE_NOT_FOUND|latest\.yml|ASSET_NOT_FOUND/i.test(text)) {
    return '此版本缺少更新文件，请等待完整发布后重试，或从 GitHub 下载完整安装包覆盖安装。';
  }
  if (/401|403|404|Bad credentials|Resource not accessible/i.test(text)) {
    return '无法读取私有仓库。请检查 GitHub 登录或更新凭据：需具有 ZHIXU 仓库的 Contents 只读权限；网络异常也可能导致检查失败。';
  }
  if (/sha512|checksum|digest|signature|ERR_UPDATER_INVALID_SIGNATURE/i.test(text)) {
    return '更新文件校验失败，已停止安装。请检查网络后重新下载。';
  }
  if (/ENOSPC|disk.*space/i.test(text)) return '磁盘空间不足，请清理系统盘后重试。';
  if (/EACCES|EPERM|permission/i.test(text)) return '无法写入更新文件，请检查安装目录和系统临时目录的权限。';
  return '更新未完成，请检查网络或代理后重试。当前版本可以继续使用。';
}

const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status') }),
  z.object({ operation: z.literal('check') }),
  z.object({ operation: z.literal('install') }),
  z.object({ operation: z.literal('configure'), automatic: z.boolean(),
    token: z.string().trim().max(4096).optional(), clearToken: z.boolean().optional() })
]);

export class Updates {
  private config: { automatic: boolean; token: string; checkedAt: string } = { automatic: true, token: '', checkedAt: '' };
  private state: UpdateStatus;
  private engine?: UpdateEngine;
  private busy = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  constructor(private readonly path: string, private readonly deps: Dependencies) {
    let configError = false;
    try {
      if (existsSync(path)) {
        const parsed = z.object({ automatic: z.boolean(), token: z.string(), checkedAt: z.string() }).parse(JSON.parse(readFileSync(path, 'utf8')));
        this.config = parsed;
      }
    } catch { configError = true; }
    this.state = {
      currentVersion: deps.version, version: '', stage: deps.packaged ? 'idle' : 'unavailable',
      automatic: this.config.automatic, hasToken: !!this.config.token, access: 'none', percent: 0,
      checkedAt: this.config.checkedAt,
      message: !deps.packaged ? '开发预览不安装更新，请使用桌面安装版。' :
        configError ? '更新设置未能读取，请重新保存更新设置。' :
          this.config.automatic ? '将自动检查并下载新版本。' : '自动更新已关闭，可手动检查更新。'
    };
  }
  status(): UpdateStatus { return { ...this.state }; }
  private set(patch: Partial<UpdateStatus>) {
    Object.assign(this.state, patch);
    this.deps.notify(this.status());
  }
  private save(config = this.config) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + '.tmp', JSON.stringify(config), { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path);
    this.config = config;
  }
  start() {
    if (!this.deps.packaged) return;
    const initial = setTimeout(() => { if (this.config.automatic) void this.check(); }, 15000);
    const periodic = setInterval(() => { if (this.config.automatic) void this.check(); }, 6 * 60 * 60 * 1000);
    initial.unref(); periodic.unref(); this.timers.push(initial, periodic);
  }
  dispose() { for (const timer of this.timers) clearTimeout(timer); this.timers = []; }
  async handle(input: unknown): Promise<UpdateStatus> {
    const request = requestSchema.parse(input);
    if (request.operation === 'status') return this.status();
    if (request.operation === 'configure') {
      if (this.busy || this.state.stage === 'installing') throw new Error('更新正在进行，请稍候再修改设置');
      const token = request.clearToken ? '' : request.token ? this.deps.encrypt(request.token) : this.config.token;
      this.save({ ...this.config, automatic: request.automatic, token });
      this.set({ automatic: this.config.automatic, hasToken: !!token, access: 'none',
        message: this.state.stage === 'ready' ? '新版本已下载，重启即可更新。' : '更新设置已保存。' });
      return this.status();
    }
    if (request.operation === 'install') {
      if (this.state.stage !== 'ready' || this.busy || !this.engine) throw new Error('请先完成更新下载');
      this.busy = true;
      try {
        await this.deps.prepare();
        this.set({ stage: 'installing', message: '已保存并备份，正在重启更新…' });
        this.engine.quitAndInstall(true, true);
      } catch (error) {
        this.set({ stage: 'ready', message: error instanceof UpdatePreparationError ? error.message :
          '未能完成保存、备份或启动安装，更新已暂停。请保留当前编辑并重试。' });
      } finally { this.busy = false; }
      return this.status();
    }
    return this.check();
  }
  private async check(): Promise<UpdateStatus> {
    if (!this.deps.packaged || this.busy || ['ready', 'installing'].includes(this.state.stage)) return this.status();
    this.busy = true;
    this.set({ stage: 'checking', version: '', percent: 0, message: '正在检查新版本…' });
    try {
      let saved = '';
      try { saved = this.config.token ? this.deps.decrypt(this.config.token) : ''; }
      catch {
        this.set({ stage: 'error', message: '无法解密本机更新凭据，请在“私有仓库访问”中重新保存或移除凭据。' });
        return this.status();
      }
      const token = saved || await this.deps.credential();
      this.set({ access: saved ? 'saved' : token ? 'git' : 'none' });
      if (!token) {
        this.set({ stage: 'error', message: '更新源为私有 GitHub 仓库。请先在本机 Git 登录有权限的账号，或填写仅授权 ZHIXU 的更新凭据。' });
        return this.status();
      }
      this.engine?.removeAllListeners();
      const engine = await this.deps.engine(token);
      this.engine = engine;
      engine.on('error', error => this.set({ stage: this.state.stage === 'installing' ? 'ready' : 'error', message: updateError(error) }));
      engine.on('update-available', info => {
        this.set({ version: String(info.version), message: `发现新版本 ${info.version}，准备下载…` });
      });
      engine.on('update-not-available', () => this.set({ stage: 'idle', message: '已是最新版本。' }));
      engine.on('download-progress', info => this.set({ stage: 'downloading',
        percent: Math.max(0, Math.min(100, Number(info.percent) || 0)), message: '正在后台下载，可继续工作。' }));
      engine.on('update-downloaded', info => this.set({ stage: 'ready', version: String(info.version), percent: 100,
        message: '新版本已下载，重启即可更新。' }));
      await engine.checkForUpdates();
      const checkedAt = new Date().toISOString();
      if (this.state.stage !== 'error') {
        this.save({ ...this.config, checkedAt }); this.set({ checkedAt });
      }
      if (this.state.stage === 'checking' && this.state.version) {
        this.set({ stage: 'downloading', message: '正在后台下载，可继续工作。' });
        await engine.downloadUpdate();
      }
    } catch (error) { this.set({ stage: 'error', message: updateError(error) }); }
    finally { this.busy = false; }
    return this.status();
  }
}
