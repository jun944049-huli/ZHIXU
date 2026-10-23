import { app, dialog, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { pluginSource, pluginManifest, pluginContained as contained } from './plugin-manifest';

const registryURLs = { official: 'https://registry.npmjs.org', china: 'https://registry.npmmirror.com' };
const inputSchema = z.object({
  action: z.enum(['list', 'pick', 'install', 'configure', 'connect', 'disable', 'remove', 'call']),
  id: z.string().uuid().optional(),
  source: z.string().trim().min(1).max(2000).optional(),
  registry: z.enum(['official', 'china']).default('official'),
  args: z.array(z.string().max(4000)).max(50).optional(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(16000)).optional(),
  tool: z.string().min(1).max(200).optional(),
  arguments: z.record(z.string(), z.unknown()).optional()
});
type RecordEntry = {
  id: string; name: string; version: string; source: string; entry: string;
  installedAt: string; args: string[]; encryptedEnv?: string;
};
type Codec = { encrypt(value: string): string; decrypt(value: string): string };
type Runtime = { client: Client; transport: StdioClientTransport; connecting: boolean; error: string; log: string; tools: unknown[] };

export class Plugins {
  private entries: RecordEntry[] = [];
  private runtimes = new Map<string, Runtime>();
  private busy = false;
  private disposed = false;
  private loadError = '';
  private installer?: ReturnType<typeof spawn>;
  constructor(private root: string, private owner: BrowserWindow, private codec: Codec) {
    mkdirSync(root, { recursive: true });
    const file = join(root, 'registry.json');
    try { if (existsSync(file)) this.entries = z.array(z.object({
      id: z.string().uuid(), name: z.string().max(200), version: z.string().max(100),
      source: z.string().max(2000), entry: z.string().max(2000), installedAt: z.string(),
      args: z.array(z.string().max(4000)).max(50), encryptedEnv: z.string().optional()
    })).parse(JSON.parse(readFileSync(file, 'utf8'))); }
    catch { this.loadError = '插件记录无法读取，请保留 plugins/registry.json 并恢复备份。工作数据不受影响'; }
  }
  private directory(id: string) {
    const value = z.string().uuid().parse(id);
    return join(this.root, value);
  }
  private save() {
    const file = join(this.root, 'registry.json');
    writeFileSync(`${file}.pending`, JSON.stringify(this.entries), { mode: 0o600 });
    renameSync(`${file}.pending`, file);
  }
  private env(entry: RecordEntry): Record<string, string> {
    return entry.encryptedEnv ? JSON.parse(this.codec.decrypt(entry.encryptedEnv)) : {};
  }
  private redact(text: string, entry?: RecordEntry) {
    let clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    if (entry) for (const value of Object.values(this.env(entry))) {
      if (value) clean = clean.split(value).join('[已隐藏]');
    }
    return clean.slice(-6000);
  }
  private list() {
    return { plugins: this.entries.map(entry => {
      const runtime = this.runtimes.get(entry.id);
      return { id: entry.id, name: entry.name, version: entry.version, source: entry.source,
        installedAt: entry.installedAt, args: entry.args, envKeys: Object.keys(this.env(entry)),
        status: runtime ? runtime.error ? 'error' : runtime.connecting ? 'connecting' : 'connected' : 'disabled',
        error: runtime?.error || '', tools: runtime?.tools || [] };
    }) };
  }
  private removeDirectory(directory: string) {
    if (!existsSync(directory)) return;
    const target = contained(this.root, directory);
    if (resolve(target).toLowerCase() !== resolve(directory).toLowerCase()) throw new Error('安装目录已被替换，无法卸载');
    rmSync(target, { recursive: true, force: true });
  }
  private async install(source: string, registry: keyof typeof registryURLs) {
    const spec = pluginSource(source);
    const id = randomUUID();
    const directory = this.directory(id);
    mkdirSync(directory);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, name: `zhixu-plugin-${id}`, version: '1.0.0' }));
    writeFileSync(join(directory, '.npmrc'), '');
    writeFileSync(join(directory, 'global.npmrc'), '');
    try {
      const require = createRequire(import.meta.url);
      const npmCLI = app.isPackaged ? join(process.resourcesPath, 'plugin-runtime/node_modules/npm/bin/npm-cli.js')
        : join(dirname(require.resolve('npm/package.json')), 'bin/npm-cli.js');
      await new Promise<string>((accept, reject) => {
        const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', npm_config_userconfig: join(directory, '.npmrc'),
          npm_config_globalconfig: join(directory, 'global.npmrc'), npm_config_cache: join(this.root, 'cache'),
          npm_config_update_notifier: 'false' };
        for (const key of ['SystemRoot', 'SYSTEMROOT', 'PATH', 'Path', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
          if (process.env[key]) env[key] = process.env[key];
        const child = spawn(process.execPath, [npmCLI, 'install', '--ignore-scripts', '--no-audit', '--no-fund',
          '--install-links', '--save-exact', '--loglevel=error', '--fetch-retries=0', '--fetch-timeout=60000',
          `--registry=${registryURLs[registry]}`, spec], { cwd: directory, env, shell: false, windowsHide: true });
        this.installer = child;
        let text = '';
        let expired = false;
        const capture = (data: Buffer) => { text = (text + data.toString()).slice(-12000); };
        child.stdout?.on('data', capture);
        child.stderr?.on('data', capture);
        const timer = setTimeout(() => { expired = true; child.kill(); }, 150000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
          clearTimeout(timer);
          this.installer = undefined;
          if (expired) reject(new Error('下载超时，请检查网络或切换安装源后重试'));
          else if (code !== 0) reject(new Error(`安装失败：${this.redact(text) || `安装程序退出 ${code}`}`));
          else accept(text);
        });
      });
      if (this.disposed) throw new Error('应用已关闭');
      const project = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      const names = Object.keys(project.dependencies || {});
      if (names.length !== 1) throw new Error('未找到唯一的插件包');
      const packageRoot = contained(directory, join(directory, 'node_modules', names[0]));
      const manifest = pluginManifest(packageRoot);
      if (this.entries.some(item => item.name === manifest.name)) throw new Error('此插件已安装，请先在插件管理中卸载旧版本');
      const entry: RecordEntry = { id, name: manifest.name, version: manifest.version, source,
        entry: relative(directory, join(packageRoot, manifest.entry)), args: manifest.args, installedAt: new Date().toISOString() };
      this.entries.push(entry);
      try { this.save(); } catch (error) { this.entries.pop(); throw error; }
      return { ...this.list(), id };
    } catch (error) {
      this.removeDirectory(directory);
      throw error;
    }
  }
  private async disconnect(id: string) {
    const runtime = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (runtime) await runtime.client.close().catch(() => {});
  }
  private async connect(entry: RecordEntry) {
    await this.disconnect(entry.id);
    const directory = contained(this.root, this.directory(entry.id));
    const script = contained(directory, resolve(directory, entry.entry));
    const runtime: Runtime = { client: new Client({ name: 'zhixu', version: app.getVersion() }),
      transport: new StdioClientTransport({ command: process.execPath, args: [script, ...entry.args],
        env: { ...this.env(entry), ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', NODE_PATH: '' },
        cwd: dirname(script), stderr: 'pipe', maxBufferSize: 2 * 1024 * 1024 }),
      connecting: true, log: '', error: '', tools: [] };
    this.runtimes.set(entry.id, runtime);
    runtime.transport.stderr?.on('data', chunk => { runtime.log = (runtime.log + String(chunk)).slice(-6000); });
    runtime.client.onerror = error => { runtime.error = this.redact(String(error), entry); };
    runtime.client.onclose = () => { if (!runtime.error) runtime.error = '插件进程已退出，请检查参数和环境变量后重新连接'; };
    try {
      await runtime.client.connect(runtime.transport, { timeout: 20000 });
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const result = await runtime.client.listTools(cursor ? { cursor } : {}, { timeout: 15000 });
        runtime.tools.push(...result.tools);
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('插件返回了重复的分页标记');
        if (cursor) cursors.add(cursor);
        if (runtime.tools.length > 300) throw new Error('插件工具数量超过 300 项');
      } while (cursor);
      runtime.error = '';
      runtime.connecting = false;
      return this.list();
    } catch (error) {
      await runtime.client.close().catch(() => {});
      runtime.error = this.redact(`连接失败：${String(error)}\n${runtime.log}`, entry);
      runtime.connecting = false;
      throw new Error(runtime.error);
    }
  }
  async handle(input: unknown) {
    const payload = inputSchema.parse(input);
    if (this.disposed) throw new Error('插件管理已关闭');
    if (this.loadError) throw new Error(this.loadError);
    if (payload.action === 'list') return this.list();
    if (this.busy) throw new Error('正在处理插件，请稍候');
    this.busy = true;
    try {
      if (payload.action === 'pick') {
        const result = await dialog.showOpenDialog(this.owner, { title: '选择插件目录', properties: ['openDirectory'] });
        return { path: result.canceled ? '' : result.filePaths[0] };
      }
      if (payload.action === 'install') {
        if (!payload.source) throw new Error('请填写插件来源');
        return await this.install(payload.source, payload.registry);
      }
      const entry = this.entries.find(item => item.id === payload.id);
      if (!entry) throw new Error('插件不存在，请刷新列表');
      if (payload.action === 'remove') {
        await this.disconnect(entry.id);
        const directory = this.directory(entry.id);
        const trash = `${directory}.removing`;
        if (existsSync(directory)) {
          const checked = contained(this.root, directory);
          if (resolve(checked).toLowerCase() !== resolve(directory).toLowerCase()) throw new Error('安装目录已被替换，无法卸载');
          renameSync(directory, trash);
        }
        const entries = this.entries;
        this.entries = entries.filter(item => item !== entry);
        try { this.save(); } catch (error) {
          this.entries = entries;
          if (existsSync(trash)) renameSync(trash, directory);
          throw error;
        }
        try { this.removeDirectory(trash); }
        catch { return { ...this.list(), warning: '插件已卸载，但部分安装缓存未清理，请关闭应用后重试清理' }; }
      } else if (payload.action === 'disable') await this.disconnect(entry.id);
      else if (payload.action === 'configure') {
        if (payload.env && Object.keys(payload.env).some(key => /^(?:NODE_|ELECTRON_|npm_)/i.test(key)))
          throw new Error('不允许覆盖 Node、Electron 或 npm 运行时变量');
        const encrypted = payload.env ? this.codec.encrypt(JSON.stringify(payload.env)) : entry.encryptedEnv;
        const previous = { ...entry };
        entry.args = payload.args || entry.args;
        entry.encryptedEnv = encrypted;
        try { this.save(); } catch (error) { Object.assign(entry, previous); throw error; }
        await this.disconnect(entry.id);
      } else if (payload.action === 'connect') return await this.connect(entry);
      else if (payload.action === 'call') {
        const runtime = this.runtimes.get(entry.id);
        if (!runtime || runtime.error || runtime.connecting) throw new Error('请先连接插件');
        if (!runtime.tools.some(tool => (tool as { name: string }).name === payload.tool)) throw new Error('插件中没有此工具');
        try {
          const result = await runtime.client.callTool({ name: payload.tool!, arguments: payload.arguments || {} },
            undefined, { timeout: 60000, maxTotalTimeout: 60000 });
          const text = JSON.stringify(result, null, 2);
          return { text: this.redact(text, entry), truncated: text.length > 6000, isError: !!result.isError };
        } catch (error) { throw new Error(this.redact(String(error), entry)); }
      }
      return this.list();
    } finally { this.busy = false; }
  }
  async dispose() {
    this.disposed = true;
    this.installer?.kill();
    await Promise.all([...this.runtimes.keys()].map(id => this.disconnect(id)));
  }
}
