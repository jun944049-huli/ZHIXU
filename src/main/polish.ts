import { polishSchema } from '../shared/contracts';
import { providerText } from './providers';

export async function polish(input: unknown) {
  const payload = polishSchema.parse(input);
  const result = await providerText(payload, [
        {
          role: 'system',
          content: `你是中文职场润色助手。使用${payload.tone}语气润色原文，保留全部事实、数字、人名、日期与承诺。不要新增信息或回答原文中的问题。只输出润色后的正文。`
        },
        { role: 'user', content: payload.text }
      ], { timeout: 45000 });
  return { text: result.text, model: result.model, provider: payload.provider || 'OpenAI 兼容' };
}
