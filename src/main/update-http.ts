import { ElectronHttpExecutor, getNetSession } from 'electron-updater/out/electronHttpExecutor.js';
import type { DownloadOptions } from 'builder-util-runtime';
import type { ClientRequest } from 'electron';

export function updateProxy(environment: NodeJS.ProcessEnv): Electron.ProxyConfig {
  const address = environment.HTTPS_PROXY || environment.https_proxy || environment.HTTP_PROXY || environment.http_proxy;
  if (!address) return { mode: 'system' };
  let url: URL;
  try { url = new URL(address); }
  catch { throw new Error('更新代理配置无效，请检查系统代理或 HTTPS_PROXY 设置。'); }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('更新代理配置无效，请检查系统代理或 HTTPS_PROXY 设置。');
  }
  return {
    proxyRules: `${url.protocol}//${url.host}`,
    proxyBypassRules: '<local>;' + (environment.NO_PROXY || environment.no_proxy || '').split(',').join(';')
  };
}

export class UpdateHttpExecutor extends ElectronHttpExecutor {
  private active = new Set<ClientRequest>();
  constructor(private readonly inactivityMs = 60000) { super(); }

  // Electron requests have no Node socket, so the upstream socket timeout never runs.
  override addErrorAndTimeoutHandlers(request: ClientRequest, reject: (error: Error) => void) {
    super.addErrorAndTimeoutHandlers(request, reject);
    this.active.add(request);
    let finished = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('ETIMEDOUT: update connection stalled'));
      request.abort();
    }, this.inactivityMs);
    timer.unref();
    const cleanup = () => { finished = true; clearTimeout(timer); this.active.delete(request); };
    request.once('response', response => {
      if (!finished) timer.refresh();
      response.on('data', () => { if (!finished) timer.refresh(); });
      response.once('end', cleanup);
      response.once('error', cleanup);
    });
    request.once('redirect', cleanup);
    // Electron may emit request "close" before the response has started.
    request.once('error', cleanup);
    request.once('abort', cleanup);
  }

  override async download(url: URL, destination: string, options: DownloadOptions) {
    const abort = () => { for (const request of this.active) request.abort(); };
    options.cancellationToken.once('cancel', abort);
    try { return await super.download(url, destination, options); }
    finally { options.cancellationToken.removeListener('cancel', abort); }
  }
}

export async function configureUpdateTransport(engine: object) {
  await getNetSession().setProxy(updateProxy(process.env));
  // electron-updater 6.8.11 exposes this runtime field but omits it from its types.
  (engine as { httpExecutor: ElectronHttpExecutor }).httpExecutor = new UpdateHttpExecutor();
}
