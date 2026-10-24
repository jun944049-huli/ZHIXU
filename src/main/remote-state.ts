import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { snapshotSchema, type WorkbenchSnapshot } from '../shared/contracts';

export const REMOTE_SECRET = '[已保存在主机]';

type ObjectValue = Record<string, any>;
const secretKey = /^(?:apiKey|deepseekKey|appSecret|appKey|corpSecret|password|token|secret)$/i;
function settingsSecrets(value: any, previous?: any, reveal = false, parent = ''): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item, index) => settingsSecrets(item, previous?.[index], reveal, parent));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (secretKey.test(key) || (parent === 'ics' && key === 'url')) {
      if (!reveal) return [key, item ? REMOTE_SECRET : ''];
      if (item === REMOTE_SECRET) {
        if (typeof previous?.[key] !== 'string' || !previous[key]) throw new Error('主机没有此凭据，请重新填写');
        return [key, previous[key]];
      }
      return [key, item];
    }
    return [key, settingsSecrets(item, previous?.[key], reveal, key)];
  }));
}

export function remoteSnapshot(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  const copy = structuredClone(snapshot);
  if (copy.db.settings) copy.db.settings = settingsSecrets(copy.db.settings);
  if (copy.preferences['jw-settings']) {
    copy.preferences['jw-settings'] = JSON.stringify(settingsSecrets(JSON.parse(copy.preferences['jw-settings'])));
  }
  return copy;
}

export function restoreRemoteSnapshot(input: unknown, current: WorkbenchSnapshot): WorkbenchSnapshot {
  const copy = snapshotSchema.parse(input);
  if (copy.db.settings) copy.db.settings = settingsSecrets(copy.db.settings, current.db.settings, true);
  if (copy.preferences['jw-settings']) {
    copy.preferences['jw-settings'] = JSON.stringify(settingsSecrets(
      JSON.parse(copy.preferences['jw-settings']), JSON.parse(current.preferences['jw-settings'] || '{}'), true));
  }
  return copy;
}

export class RevisionConflict extends Error {
  readonly status = 409;
  constructor() { super('其他设备已更新工作数据，本次编辑尚未保存。请先导出本次编辑，再重新载入后合并，避免覆盖其他设备的修改。'); }
}

export class SharedWorkbench {
  revision = randomBytes(18).toString('hex');
  constructor(private readonly store: { load(): WorkbenchSnapshot | null; save(input: unknown): void }) {}
  load() { return this.store.load(); }
  save(input: unknown, revision: string, remote = false) {
    if (revision !== this.revision) throw new RevisionConflict();
    const current = this.store.load();
    const snapshot = remote && current ? restoreRemoteSnapshot(input, current) : snapshotSchema.parse(input);
    if (current && isDeepStrictEqual(snapshot, current)) return this.revision;
    this.store.save(snapshot);
    this.revision = randomBytes(18).toString('hex');
    return this.revision;
  }
}

// A placeholder may only use the credential belonging to the same configured endpoint.
export function remotePayload(operation: string, input: any, snapshot: WorkbenchSnapshot): any {
  const value = structuredClone(input);
  const settings = (snapshot.db.settings || {}) as ObjectValue;
  const provider = (config: ObjectValue) => {
    if (config?.apiKey !== REMOTE_SECRET) return config;
    const custom = settings.customProvider;
    const url = String(config.baseUrl || '').replace(/\/+$/, '');
    const key = custom && url === String(custom.baseUrl || '').replace(/\/+$/, '')
      ? custom.apiKey : url === 'https://api.deepseek.com' ? settings.deepseekKey : '';
    if (!key) throw new Error('接口地址已修改，请填写此地址对应的 API Key，或先在桌面配置');
    return { ...config, apiKey: key };
  };
  if (['polish', 'provider-models', 'provider-diagnose'].includes(operation)) return provider(value);
  if (['chat', 'chat-summary', 'capture-task', 'document-analyze'].includes(operation) && value?.provider) {
    value.provider = provider(value.provider);
  }
  if (operation === 'integration') {
    const existing = settings.integrations?.[value?.id];
    const supplied = value?.config;
    if (!existing || !supplied) throw new Error('请先在桌面配置此连接器');
    for (const [key, item] of Object.entries(existing)) {
      if (!secretKey.test(key) && !(value.id === 'ics' && key === 'url') &&
          supplied[key] !== item) throw new Error('连接地址已变化，请先在桌面保存新的连接器配置');
    }
    value.config = settingsSecrets(supplied, existing, true, value.id);
  }
  return value;
}
