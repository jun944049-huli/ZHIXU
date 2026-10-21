import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import PostalMime from 'postal-mime';
import ical from 'node-ical';
import { integrationSchema, type IntegrationRecord, type IntegrationResult } from '../shared/contracts';

interface Dependencies {
  fetch?: (url: string, options?: RequestInit) => Promise<Response>;
  createMailbox?: (options: NonNullable<ConstructorParameters<typeof ImapFlow>[0]>) => ImapFlow;
  now?: Date;
}

class IntegrationError extends Error {}

function required(config: Record<string, string>, fields: string[]) {
  if (fields.some(field => !config[field]?.trim())) {
    throw new IntegrationError('请填写全部必填项后重试');
  }
}

async function limitedText(response: Response, maximum = 2_000_000) {
  if (!response.ok) throw new IntegrationError(`服务器返回 HTTP ${response.status}，请检查地址、凭据和访问权限`);
  const reader = response.body?.getReader();
  if (!reader) throw new IntegrationError('服务器没有返回内容');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new IntegrationError('响应超过 2 MB，请缩小订阅或查询范围');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

function scope(id: string, values: string[]) {
  return id + ':' + createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
}

export async function runIntegration(input: unknown, dependencies: Dependencies = {}): Promise<IntegrationResult> {
  const parsed = integrationSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationError('连接器请求无效，请检查配置');
  const { id, operation, config } = parsed.data;
  const fetcher = dependencies.fetch || fetch;
  const request = async (url: string, options: RequestInit = {}) => {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(20000), redirect: 'error' });
    return limitedText(response);
  };
  const json = async (url: string, options: RequestInit = {}) => {
    const result = JSON.parse(await request(url, options));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new IntegrationError('服务器返回格式不正确');
    return result;
  };
  const post = (body: object) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  try {
    if (id === 'ics') {
      required(config, ['url']);
      const url = new URL(config.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new IntegrationError('日历订阅地址须为 HTTP 或 HTTPS，且不能包含账户密码');
      }
      const raw = await request(url.href);
      if (!raw.trimStart().startsWith('BEGIN:VCALENDAR') || !raw.includes('END:VCALENDAR')) {
        throw new IntegrationError('该地址没有返回有效的 ICS 日历，请使用日历订阅链接');
      }
      const events = await ical.async.parseICS(raw);
      const now = dependencies.now || new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const to = new Date(from); to.setDate(to.getDate() + 30);
      const records: IntegrationRecord[] = [];
      for (const event of Object.values(events)) {
        if (!event || event.type !== 'VEVENT') continue;
        if (['SECONDLY', 'MINUTELY'].includes(String(event.rrule?.options.freq))) {
          throw new IntegrationError('日历包含按秒或按分钟重复的事件，请缩小订阅范围后重试');
        }
        const instances = ical.expandRecurringEvent(event, { from, to });
        for (const instance of instances) {
          const date = instance.start;
          const value = instance.event;
          if (value.status === 'CANCELLED') continue;
          const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          records.push({
            externalId: `${scope(id, [url.href])}:${value.uid}:${date.toISOString()}`,
            title: String(value.summary || '日历事项').slice(0, 120),
            raw: [
              String(value.summary || '日历事项'), `开始：${date.toLocaleString('zh-CN')}`,
              value.location ? `地点：${value.location}` : '', value.description || ''
            ].filter(Boolean).join('\n').slice(0, 12000),
            date: day
          });
        }
      }
      records.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.externalId.localeCompare(b.externalId));
      return {
        mode: 'read', message: `日历订阅有效，未来 30 天有 ${records.length} 项日程，每次最多导入 50 项`,
        records: operation === 'sync' ? records.slice(0, 50) : []
      };
    }
    if (id === 'mail') {
      required(config, ['host', 'user', 'password']);
      const port = Number(config.port || 993);
      if (!/^[a-zA-Z0-9.-]+$/.test(config.host) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new IntegrationError('请填写有效的 IMAP 主机与端口');
      }
      const mailbox = (dependencies.createMailbox || (options => new ImapFlow(options)))({
        host: config.host, port, secure: true, auth: { user: config.user, pass: config.password },
        logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
      });
      mailbox.on('error', () => {});
      try {
        await mailbox.connect();
        const lock = await mailbox.getMailboxLock(config.folder || 'INBOX', { readOnly: true });
        try {
          const box = mailbox.mailbox;
          if (!box) throw new IntegrationError('无法打开指定邮件文件夹');
          const count = box.exists;
          const records: IntegrationRecord[] = [];
          if (operation === 'sync' && count) {
            const messages = await mailbox.fetchAll(`${Math.max(1, count - 19)}:*`, { uid: true, envelope: true, size: true });
            // Fetch separately after metadata enumeration; IMAP commands inside a fetch iterator can deadlock.
            for (const message of messages.reverse()) {
              let text = '';
              if (message.size !== undefined && message.size <= 256_000) {
                const full = await mailbox.fetchOne(String(message.uid), { source: { start: 0, maxLength: 256000 } }, { uid: true });
                if (full && full.source) {
                  const mail = await PostalMime.parse(full.source);
                  text = mail.text || '此邮件为 HTML 内容，请在邮箱中查看正文。';
                }
              } else text = '邮件超过 256 KB，未下载正文与附件，请在邮箱中查看。';
              const envelope = message.envelope;
              const subject = envelope?.subject || '无主题邮件';
              records.push({
                externalId: `${scope(id, [config.host, config.user, config.folder || 'INBOX'])}:${box.uidValidity}:${message.uid}`,
                title: subject.slice(0, 120),
                raw: [`主题：${subject}`, `发件人：${envelope?.from?.map(p => p.address || p.name).join(', ') || '未知'}`, text].join('\n').slice(0, 12000)
              });
            }
          }
          return { mode: 'read', message: `IMAP 认证通过，文件夹中共 ${count} 封邮件，每次读取最近 20 封`, records };
        } finally { lock.release(); }
      } finally {
        await mailbox.logout().catch(() => { mailbox.close(); });
      }
    }
    if (id === 'feishu') {
      required(config, ['appId', 'appSecret']);
      const auth = await json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        post({ app_id: config.appId, app_secret: config.appSecret }));
      if (auth.code !== 0 || !auth.tenant_access_token) {
        throw new IntegrationError(`飞书认证失败（代码 ${Number(auth.code) || '未知'}），请检查应用凭据`);
      }
      if (!config.chatId) {
        if (operation === 'sync') throw new IntegrationError('请先填写要读取的飞书群 Chat ID');
        return { mode: 'auth', message: '应用认证通过；填写群 Chat ID 后可验证消息读取权限', records: [] };
      }
      const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
      url.search = new URLSearchParams({
        container_id_type: 'chat', container_id: config.chatId,
        page_size: operation === 'sync' ? '50' : '1', sort_type: 'ByCreateTimeDesc'
      }).toString();
      const result = await json(url.href, { headers: { Authorization: `Bearer ${auth.tenant_access_token}` } });
      if (result.code !== 0) throw new IntegrationError(`飞书消息读取失败（代码 ${Number(result.code) || '未知'}），请检查群 ID、应用可见范围和消息读取权限`);
      const items = Array.isArray(result.data?.items) ? result.data.items : [];
      const records = items.filter((item: { deleted?: boolean }) => !item.deleted).slice(0, 50).map((item: {
        message_id: string; msg_type: string; body?: { content?: string };
      }) => {
        let text = item.body?.content || '';
        try {
          const content = JSON.parse(text);
          if (typeof content.text === 'string') text = content.text;
        } catch { /* Preserve structured messages as their original content. */ }
        return {
          externalId: `${scope(id, [config.appId, config.chatId])}:${item.message_id}`,
          title: (text || `飞书${item.msg_type}消息`).slice(0, 120), raw: text.slice(0, 12000)
        };
      });
      return { mode: 'read', message: '飞书应用与群消息读取权限验证通过', records: operation === 'sync' ? records : [] };
    }
    if (operation === 'sync') throw new IntegrationError('此连接器目前支持应用认证，消息接收尚未接入');
    if (id === 'dingtalk') {
      required(config, ['appKey', 'appSecret']);
      const result = await json('https://api.dingtalk.com/v1.0/oauth2/accessToken',
        post({ appKey: config.appKey, appSecret: config.appSecret }));
      if (!result.accessToken) throw new IntegrationError('钉钉认证失败，请检查 AppKey 和 AppSecret');
      return { mode: 'auth', message: '钉钉应用认证通过；消息接收尚未接入', records: [] };
    }
    required(config, ['corpId', 'corpSecret']);
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
    url.search = new URLSearchParams({ corpid: config.corpId, corpsecret: config.corpSecret }).toString();
    const result = await json(url.href);
    if (result.errcode !== 0 || !result.access_token) {
      throw new IntegrationError(`企业微信认证失败（代码 ${Number(result.errcode) || '未知'}），请检查凭据和可信 IP`);
    }
    return { mode: 'auth', message: '企业微信应用认证通过；消息接收尚未接入', records: [] };
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    const code = (error as { code?: string; cause?: { code?: string } })?.cause?.code ||
      (error as { code?: string })?.code;
    if (code === 'ENOTFOUND') throw new IntegrationError('主机名无法解析，请检查服务器地址与网络');
    if (code?.includes('CERT') || code?.includes('TLS')) throw new IntegrationError('服务器 TLS 证书验证失败，请检查地址与系统时间');
    if ((error as Error)?.name === 'TimeoutError' || code?.includes('TIMEOUT')) {
      throw new IntegrationError('连接超时，请检查服务器地址、端口和网络');
    }
    throw new IntegrationError('连接失败，请检查凭据、服务器权限、SSL/TLS 和网络后重试');
  }
}
