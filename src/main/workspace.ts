import { BrowserWindow, WebContentsView, dialog, shell } from 'electron';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { z } from 'zod';
import type { WorkspaceEvent, WorkspaceResult } from '../shared/contracts';

const requestSchema = z.object({
  operation: z.enum(['folder-pick', 'folder-list', 'file-read', 'file-open',
    'browser-layout', 'browser-navigate', 'browser-back', 'browser-forward', 'browser-reload',
    'terminal-run', 'terminal-stop']),
  rootId: z.string().max(100).optional(),
  path: z.string().max(4096).default(''),
  url: z.string().max(8192).optional(),
  command: z.string().trim().min(1).max(32000).optional(),
  visible: z.boolean().optional(),
  bounds: z.object({ x: z.number().finite(), y: z.number().finite(),
    width: z.number().finite(), height: z.number().finite() }).optional()
});

export function browserURL(value: string): string {
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请输入 HTTP 或 HTTPS 网页地址，不支持文件地址或带密码的地址');
  }
  return url.href;
}

export async function scopedPath(root: string, input: string): Promise<string> {
  const target = await realpath(resolve(root, input));
  const rel = relative(root, target);
  if (isAbsolute(input) || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) {
    throw new Error('只能访问已选择文件夹中的文件');
  }
  return target;
}

export class Workspace {
  private roots = new Map<string, string>();
  private browser?: WebContentsView;
  private terminal?: ChildProcessWithoutNullStreams;
  private terminalRoot = '';
  private commandId = '';
  private marker = '';
  private outputBuffer = '';
  private outputBytes = 0;
  private outputLimited = false;
  private disposed = false;

  constructor(private window: BrowserWindow) {}

  private emit(event: WorkspaceEvent) {
    if (!this.disposed && !this.window.isDestroyed()) this.window.webContents.send('workbench:workspace-event', event);
  }

  private root(id?: string) {
    const root = this.roots.get(id || '');
    if (!root) throw new Error('请先选择工作文件夹');
    return root;
  }

  private browserState(error = '') {
    const contents = this.browser?.webContents;
    if (!contents || contents.isDestroyed()) return;
    this.emit({ type: 'browser', url: contents.getURL(), title: contents.getTitle(),
      loading: contents.isLoading(), canBack: contents.navigationHistory.canGoBack(),
      canForward: contents.navigationHistory.canGoForward(), error });
  }

  private ensureBrowser() {
    if (this.browser) return this.browser;
    const view = new WebContentsView({ webPreferences: {
      partition: 'persist:zhixu-workspace-browser', contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true
    } });
    this.browser = view;
    view.setVisible(false);
    view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    view.webContents.session.setPermissionCheckHandler(() => false);
    const preventUnsupported = (event: Electron.Event, url: string) => {
      try { browserURL(url); } catch { event.preventDefault(); }
    };
    view.webContents.on('will-navigate', preventUnsupported);
    view.webContents.on('will-redirect', preventUnsupported);
    view.webContents.setWindowOpenHandler(({ url }) => {
      try { void view.webContents.loadURL(browserURL(url)).catch(error => this.browserState(String(error))); }
      catch (error) { this.browserState(String(error)); }
      return { action: 'deny' };
    });
    view.webContents.on('did-start-loading', () => this.browserState());
    view.webContents.on('did-stop-loading', () => this.browserState());
    view.webContents.on('page-title-updated', () => this.browserState());
    view.webContents.on('did-navigate', () => this.browserState());
    view.webContents.on('did-navigate-in-page', () => this.browserState());
    view.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.browserState(`网页加载失败：${description} (${code})`);
    });
    this.window.contentView.addChildView(view);
    return view;
  }

  async handle(input: unknown): Promise<WorkspaceResult> {
    const request = requestSchema.parse(input);
    switch (request.operation) {
      case 'folder-pick': {
        const selected = await dialog.showOpenDialog(this.window, {
          title: '选择工作文件夹', properties: ['openDirectory']
        });
        if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
        const path = await realpath(selected.filePaths[0]);
        let id = [...this.roots].find(([, value]) => value === path)?.[0];
        if (!id) { id = randomUUID(); this.roots.set(id, path); }
        return { root: { id, name: basename(path) || path, path } };
      }
      case 'folder-list': {
        const path = await scopedPath(this.root(request.rootId), request.path);
        const entries = await readdir(path, { withFileTypes: true });
        const safeEntries = entries.filter(entry => !entry.isSymbolicLink()).sort((a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN'));
        return { entries: safeEntries.slice(0, 2000).map(entry => ({
          name: entry.name, directory: entry.isDirectory(),
          path: join(request.path, entry.name)
        })), truncated: safeEntries.length > 2000 };
      }
      case 'file-read': {
        const path = await scopedPath(this.root(request.rootId), request.path);
        const metadata = await stat(path);
        if (!metadata.isFile()) throw new Error('请选择文件');
        const extension = extname(path).toLowerCase();
        const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        if (images[extension] && metadata.size <= 10 * 1024 * 1024) {
          return { image: `data:${images[extension]};base64,${(await readFile(path)).toString('base64')}` };
        }
        if (!['.txt', '.md', '.csv', '.tsv', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx',
          '.jsx', '.html', '.css', '.xml', '.yaml', '.yml', '.log', '.ini', '.toml', '.py',
          '.ps1', '.sh', '.sql', '.gitignore', ''].includes(extension)) return { binary: true };
        if (metadata.size > 2 * 1024 * 1024) throw new Error('文本预览上限为 2 MB，可使用系统应用打开');
        const bytes = await readFile(path);
        if (bytes.includes(0)) return { binary: true };
        return { text: bytes.toString('utf8') };
      }
      case 'file-open': {
        const path = await scopedPath(this.root(request.rootId), request.path);
        const error = await shell.openPath(path);
        if (error) throw new Error(error);
        return {};
      }
      case 'browser-layout': {
        if (!request.visible) { this.browser?.setVisible(false); return {}; }
        const view = this.ensureBrowser();
        const bounds = request.bounds;
        if (!bounds) throw new Error('缺少浏览器显示区域');
        const size = this.window.getContentBounds();
        const x = Math.max(0, Math.round(bounds.x)), y = Math.max(0, Math.round(bounds.y));
        const width = Math.max(0, Math.min(Math.round(bounds.width), size.width - x));
        const height = Math.max(0, Math.min(Math.round(bounds.height), size.height - y));
        view.setBounds({ x, y, width, height });
        view.setVisible(width > 0 && height > 0);
        return {};
      }
      case 'browser-navigate': {
        const url = browserURL(request.url || '');
        const browser = this.ensureBrowser();
        void browser.webContents.loadURL(url).catch(error => this.browserState(String(error)));
        return {};
      }
      case 'browser-back':
        if (this.browser?.webContents.navigationHistory.canGoBack()) this.browser.webContents.navigationHistory.goBack();
        return {};
      case 'browser-forward':
        if (this.browser?.webContents.navigationHistory.canGoForward()) this.browser.webContents.navigationHistory.goForward();
        return {};
      case 'browser-reload':
        this.browser?.webContents.reload();
        return {};
      case 'terminal-stop':
        this.stopTerminal();
        return {};
      case 'terminal-run':
        this.runCommand(this.root(request.rootId), request.command || '');
        return {};
    }
  }

  private sendOutput(text: string, stream: 'stdout' | 'stderr' = 'stdout') {
    if (!text || this.outputLimited) return;
    const remaining = 1_000_000 - this.outputBytes;
    this.outputBytes += Buffer.byteLength(text);
    this.emit({ type: 'terminal', id: this.commandId, text: stripVTControlCharacters(text).slice(0, remaining), stream });
    if (this.outputBytes > 1_000_000) {
      this.outputLimited = true;
      this.emit({ type: 'terminal', id: this.commandId, text: '\n输出已达 1 MB，本次后续输出已省略。\n' });
    }
  }

  private startTerminal(root: string) {
    this.marker = `ZHIXU_${randomUUID().replaceAll('-', '')}:`;
    // A persistent shell keeps its working directory and variables between commands.
    const loop = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; ` +
      `while ($null -ne ($zhixuLine = [Console]::ReadLine())) { ` +
      `try { . ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($zhixuLine)))) } ` +
      `catch { [Console]::Error.WriteLine($_.ToString()) } }`;
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell',
      'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(loop, 'utf16le').toString('base64')], { cwd: root, windowsHide: true, stdio: 'pipe' });
    this.terminal = child;
    this.terminalRoot = root;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (this.terminal !== child) return;
      this.outputBuffer += data;
      let newline: number;
      while ((newline = this.outputBuffer.indexOf('\n')) !== -1) {
        const line = this.outputBuffer.slice(0, newline + 1);
        this.outputBuffer = this.outputBuffer.slice(newline + 1);
        const markerAt = line.indexOf(this.marker);
        if (markerAt >= 0) {
          this.sendOutput(line.slice(0, markerAt));
          const [code, cwd] = line.slice(markerAt + this.marker.length).trim().split(':');
          this.emit({ type: 'terminal', id: this.commandId, done: true, exitCode: Number(code),
            cwd: Buffer.from(cwd || '', 'base64').toString('utf8') });
          this.commandId = '';
        } else this.sendOutput(line);
      }
      if (this.outputBuffer.length > 8192 && !this.outputBuffer.includes(this.marker)) {
        this.sendOutput(this.outputBuffer); this.outputBuffer = '';
      }
    });
    child.stderr.on('data', (data: string) => {
      if (this.terminal === child) this.sendOutput(data, 'stderr');
    });
    child.on('error', error => {
      if (this.terminal === child) this.sendOutput(`终端启动失败：${error.message}\n`, 'stderr');
    });
    child.on('close', code => {
      if (this.terminal !== child) return;
      this.sendOutput(this.outputBuffer);
      this.emit({ type: 'terminal', id: this.commandId, done: true, exitCode: code ?? 1, closed: true });
      this.terminal = undefined;
      this.commandId = '';
      this.outputBuffer = '';
    });
  }

  private runCommand(root: string, command: string) {
    if (!command.trim()) throw new Error('请输入命令');
    if (this.commandId) throw new Error('当前命令尚未结束，可先停止');
    if (this.terminal && this.terminalRoot !== root) this.stopTerminal();
    if (!this.terminal) this.startTerminal(root);
    this.commandId = randomUUID();
    this.outputBytes = 0;
    this.outputLimited = false;
    this.emit({ type: 'terminal', id: this.commandId, started: true });
    const encoded = Buffer.from(command, 'utf8').toString('base64');
    const wrapper = `$global:LASTEXITCODE = 0; $zhixuExit = 0; try { ` +
      `. ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))); ` +
      `if (-not $?) { $zhixuExit = 1 }; if ($LASTEXITCODE) { $zhixuExit = $LASTEXITCODE } ` +
      `} catch { [Console]::Error.WriteLine($_.ToString()); $zhixuExit = 1 }; ` +
      `[Console]::Out.WriteLine('${this.marker}' + $zhixuExit + ':' + ` +
      `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path)))`;
    this.terminal!.stdin.write(Buffer.from(wrapper, 'utf8').toString('base64') + '\n');
  }

  private stopTerminal() {
    const child = this.terminal;
    if (!child) return;
    this.terminal = undefined;
    if (child.pid) {
      spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    }
    child.stdin.destroy();
    this.emit({ type: 'terminal', id: this.commandId, done: true, closed: true, text: '\n已停止终端进程。\n' });
    this.commandId = '';
    this.outputBuffer = '';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTerminal();
    if (this.browser && !this.browser.webContents.isDestroyed()) {
      this.window.contentView.removeChildView(this.browser);
      this.browser.webContents.close();
    }
  }
}
