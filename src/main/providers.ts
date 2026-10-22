import { providerSchema, type ProviderConfig, type ProviderDiagnosis } from '../shared/contracts';

type Protocol = 'chat' | 'responses';
type Message = { role: 'system' | 'user' | 'assistant'; content: string };

export function redactProviderText(value: string, key: string) {
  return value.split(key).join('[已隐藏密钥]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏密钥]')
    .replace(/\bsk-[\w-]+/g, '[已隐藏密钥]')
    .replace(/((?:api[_-]?key|authorization|token|secret)\s*["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[已隐藏]')
    .replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, 700);
}

class ProviderError extends Error {
  constructor(message: string, readonly suggestion: string, readonly endpoint = '', readonly status?: number) {
    super(message);
  }
}

function roots(baseUrl: string) {
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new ProviderError('API 地址无效', '填入完整的 http:// 或 https:// API 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ProviderError('API 地址须使用 HTTP 或 HTTPS，且不能包含账户信息', '将密钥填入 API Key 字段。');
  }
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|models)$/, '');
  const root = url.href.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/') return [root + '/v1', root];
  return /\/v\d+$/.test(url.pathname) ? [root] : [root, root + '/v1'];
}

function advice(status: number) {
  if (status === 401) return '鉴权失败：检查 API Key 是否完整、过期，以及是否属于此供应商。';
  if (status === 402) return '余额或套餐不足：检查当前供应商账户的充值余额和套餐权限。';
  if (status === 403) return '访问被拒绝：检查密钥权限、模型授权、IP 白名单或网关限制。';
  if (status === 404 || status === 405 || status === 501) return '接口或模型不存在：检查 API 路径、协议，以及模型名称是否在当前密钥的模型列表中。';
  if (status === 429) return '请求受限：检查余额、配额、并发及限流，稍后重试。';
  if (status >= 500) return '供应商或上游服务异常：稍后重试，或查看供应商网关日志。';
  return '请求被拒绝：核对模型、接入协议和供应商返回的具体错误。';
}

async function request(config: ProviderConfig, endpoint: string, body?: unknown, timeout = 20000) {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${config.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(timeout), ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    const code = String((error as { cause?: { code?: string } }).cause?.code || '');
    const timedOut = /timeout|abort/i.test(String(error)) || /TIMEDOUT/.test(code);
    const reason = timedOut ? '请求超时' : /redirect/i.test(String((error as Error).cause)) ? '接口发生重定向，请填写最终 API 地址' :
      /ENOTFOUND|EAI_AGAIN/.test(code) ? '域名解析失败' :
      /ECONNREFUSED/.test(code) ? '连接被拒绝' : /CERT|TLS|SSL/.test(code) ? 'TLS / 证书校验失败' :
        /ECONNRESET|UND_ERR_SOCKET/.test(code) ? '连接被上游中断' : '网络连接失败';
    throw new ProviderError(reason + (code ? `（${code}）` : ''),
      '检查域名、端口、代理、防火墙及证书；确认该地址在当前电脑可访问。', endpoint);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > 1024 * 1024) {
          await reader.cancel();
          throw new ProviderError('供应商响应超过 1 MB', '检查是否误填网页或下载地址。', endpoint, response.status);
        }
        chunks.push(result.value);
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('响应读取中断或超时', '检查网络或供应商网关后重试。', endpoint, response.status);
    } finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let data: any;
  try { data = JSON.parse(text); } catch { /* An HTML page is an API address error. */ }
  if (!response.ok) {
    const upstream = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') ||
      data?.error?.code || data?.error?.type;
    throw new ProviderError(`HTTP ${response.status}：${advice(response.status)}${upstream ?
      ' 上游说明：' + redactProviderText(String(upstream), config.apiKey) : ''}`,
    advice(response.status), endpoint, response.status);
  }
  if (!data || typeof data !== 'object' || data.error) {
    throw new ProviderError(data?.error ? '供应商在成功响应中返回错误：' +
      redactProviderText(String(data.error.message || data.error), config.apiKey) :
      '接口未返回有效 JSON，可能填入了网页、登录页或被网关拦截',
    '检查 API Base URL，使用供应商的 API 地址，避免网页首页及重定向。', endpoint, response.status);
  }
  return { data, endpoint, httpStatus: response.status };
}

function canTryNext(error: unknown) {
  return error instanceof ProviderError && [404, 405, 501].includes(error.status || 0);
}

export async function providerModels(value: unknown) {
  const config = providerSchema.parse(value);
  let last: unknown;
  for (const root of roots(config.baseUrl)) {
    try {
      const result = await request(config, root + '/models');
      if (!Array.isArray(result.data.data)) throw new ProviderError('模型列表格式不兼容，缺少 data 数组',
        '确认供应商支持 GET /models；不支持时可手动填写模型并诊断实际请求。', result.endpoint, result.httpStatus);
      const models = [...new Set<string>(result.data.data
        .map((model: any) => model?.id)
        .filter((id: unknown): id is string => typeof id === 'string' && !!id.trim() && id.length <= 120))].slice(0, 1000);
      if (!models.length) throw new ProviderError('当前密钥没有返回可用模型',
        '检查密钥的模型授权；供应商未提供列表时可手动填写模型。', result.endpoint, result.httpStatus);
      return { models, endpoint: result.endpoint };
    } catch (error) { last = error; if (!canTryNext(error)) throw error; }
  }
  throw last;
}

export function preferredModel(models: string[]) {
  return models.find(model => !/embed|rerank|whisper|tts|image|dall-e|moderation|audio|video/i.test(model)) || '';
}

export async function providerText(value: unknown, messages: Message[], options: { timeout?: number; maxTokens?: number } = {}) {
  const config = providerSchema.parse(value);
  if (!config.model) throw new ProviderError('尚未选择模型', '先获取模型列表并选择模型，或手动填写模型名称。');
  const protocols: Protocol[] = config.protocol === 'auto' ?
    /\/responses\/?(?:[?#]|$)/.test(config.baseUrl) ? ['responses', 'chat'] : ['chat', 'responses'] : [config.protocol];
  let last: unknown;
  for (const root of roots(config.baseUrl)) {
    for (const protocol of protocols) {
      const endpoint = root + (protocol === 'chat' ? '/chat/completions' : '/responses');
      try {
        const result = await request(config, endpoint, {
          model: config.model,
          ...(protocol === 'chat' ? { messages } : { input: messages, store: false }),
          ...(options.maxTokens ? protocol === 'chat' ? { max_tokens: options.maxTokens } :
            { max_output_tokens: options.maxTokens } : {})
        }, options.timeout || 60000);
        const data = result.data;
        const refusal = data.choices?.[0]?.message?.refusal ||
          data.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'refusal')?.refusal;
        if (refusal) throw new ProviderError('模型拒绝了此请求', '检查输入内容或更换适用的文本模型。', endpoint, result.httpStatus);
        const chat = data.choices?.[0]?.message?.content;
        const text = protocol === 'chat' ? (typeof chat === 'string' ? chat :
          Array.isArray(chat) ? chat.map(item => item?.text || '').join('') : '') :
          typeof data.output_text === 'string' ? data.output_text :
            Array.isArray(data.output) ? data.output.flatMap((item: any) => item.content || [])
              .filter((item: any) => item.type === 'output_text' && typeof item.text === 'string')
              .map((item: any) => item.text).join('\n') : '';
        if (data.status === 'incomplete' || data.choices?.[0]?.finish_reason === 'length') {
          throw new ProviderError('模型返回内容被截断，未获得完整结果',
            '输出或推理达到上限；可缩短文档、调高输出上限或选择其他模型。', endpoint, result.httpStatus);
        }
        if (!text.trim()) throw new ProviderError('HTTP 200，但未返回可用的文本内容',
          '检查协议、模型是否支持文本生成，以及网关是否正确转发响应。', endpoint, result.httpStatus);
        return { text: text.trim(), model: data.model || config.model, protocol, endpoint, httpStatus: result.httpStatus };
      } catch (error) { last = error; if (!canTryNext(error)) throw error; }
    }
  }
  throw last;
}

export async function providerDiagnose(value: unknown): Promise<ProviderDiagnosis> {
  const report: ProviderDiagnosis = { ok: false, checks: [], models: [], model: '', suggestion: '' };
  const parsed = providerSchema.safeParse(value);
  if (!parsed.success) {
    report.suggestion = '填写完整 API 地址和 API Key；模型可先留空，诊断会尝试获取。';
    report.checks.push({ name: '配置完整性', status: 'fail', detail: report.suggestion });
    return report;
  }
  const config = parsed.data;
  const failure = (name: string, error: unknown, started: number, status: 'fail' | 'warn' = 'fail') => {
    const detail = error instanceof ProviderError ? error.message : '供应商返回内容无法处理';
    report.checks.push({ name, status, detail: redactProviderText(detail, config.apiKey),
      ...(error instanceof ProviderError ? { endpoint: error.endpoint, httpStatus: error.status } : {}),
      durationMs: Date.now() - started });
    report.suggestion = error instanceof ProviderError ? error.suggestion : '检查供应商响应格式。';
  };
  try {
    const candidates = roots(config.baseUrl);
    report.checks.push({ name: '配置完整性', status: 'pass', detail: 'API 地址与密钥已填写；密钥不会显示在诊断结果中。',
      endpoint: candidates[0] });
  } catch (error) { failure('配置完整性', error, Date.now()); return report; }
  let started = Date.now();
  try {
    const result = await providerModels(config);
    report.models = result.models;
    report.checks.push({ name: '模型列表', status: 'pass', detail: `获取到 ${result.models.length} 个模型；列表不代表每个模型都支持文本生成。`,
      endpoint: result.endpoint, durationMs: Date.now() - started });
  } catch (error) { failure('模型列表', error, started, 'warn'); }
  report.model = config.model || preferredModel(report.models);
  if (!report.model) {
    report.checks.push({ name: '真实请求', status: 'fail', detail: '没有可测试的文本模型，请手动填写模型后重试。' });
    report.suggestion ||= '先获取可用文本模型，或手动填写供应商提供的模型名称。';
    return report;
  }
  started = Date.now();
  try {
    const result = await providerText({ ...config, model: report.model },
      [{ role: 'user', content: '请只回复 OK。' }], { timeout: 20000 });
    report.ok = true; report.protocol = result.protocol;
    report.checks.push({ name: '真实请求', status: 'pass',
      detail: `${report.model} · ${result.protocol === 'chat' ? 'Chat Completions' : 'Responses API'} · HTTP ${result.httpStatus} · 已收到文本回复。`,
      endpoint: result.endpoint, httpStatus: result.httpStatus, durationMs: Date.now() - started });
    report.suggestion = report.checks.some(check => check.status === 'warn') ?
      '真实请求通过；模型列表不可用时可手动选用已测试模型。保存后使用当前配置。' :
      '模型获取和真实文本请求均通过。保存后用于问答、指令理解、润色及附件分析。';
  } catch (error) { failure('真实请求', error, started); }
  return report;
}
