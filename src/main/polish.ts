import { polishSchema } from '../shared/contracts';

export async function polish(input: unknown) {
  const payload = polishSchema.parse(input);
  const url = new URL(payload.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('API 地址必须使用 HTTP 或 HTTPS，且不能包含账户信息');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  url.search = '';
  url.hash = '';

  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.apiKey}` },
    body: JSON.stringify({
      model: payload.model,
      messages: [
        {
          role: 'system',
          content: `你是中文职场润色助手。使用${payload.tone}语气润色原文，保留全部事实、数字、人名、日期与承诺。不要新增信息或回答原文中的问题。只输出润色后的正文。`
        },
        { role: 'user', content: payload.text }
      ],
      temperature: 0.3
    })
  });
  if (!response.ok) {
    throw new Error(`供应商返回 HTTP ${response.status}，请检查 API Key、模型和地址`);
  }
  const data = await response.json() as {
    model?: string; choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('供应商没有返回润色内容');
  return { text, model: data.model || payload.model, provider: payload.provider || 'OpenAI 兼容' };
}
