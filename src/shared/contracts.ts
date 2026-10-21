import { z } from 'zod';

const entity = z.object({ id: z.string().min(1) }).passthrough();
export const snapshotSchema = z.object({
  db: z.object({
    meta: z.object({ today: z.iso.date() }).passthrough(),
    projects: z.array(entity),
    tasks: z.object({
      must: z.array(entity),
      should: z.array(entity),
      could: z.array(entity)
    }),
    inbox: z.array(entity),
    taskCalendar: z.record(z.string(), z.array(entity)).optional()
  }).passthrough(),
  preferences: z.record(z.string().startsWith('jw-'), z.string())
});

export type WorkbenchSnapshot = z.infer<typeof snapshotSchema>;

export const integrationSchema = z.object({
  id: z.enum(['feishu', 'dingtalk', 'wecom', 'mail', 'ics']),
  operation: z.enum(['test', 'sync']),
  config: z.record(z.string().max(40), z.string().max(4096))
});

export interface IntegrationRecord {
  externalId: string;
  title: string;
  raw: string;
  date?: string;
}

export interface IntegrationResult {
  mode: 'read' | 'auth';
  message: string;
  records: IntegrationRecord[];
}

export const polishSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  tone: z.enum(['简洁', '正式', '有说服力', '温和']).default('简洁'),
  apiKey: z.string().trim().min(1).max(4096),
  baseUrl: z.url().default('https://api.deepseek.com'),
  model: z.string().trim().min(1).max(120).default('deepseek-chat'),
  provider: z.string().max(60).optional()
});

export interface DesktopAPI {
  load(): Promise<WorkbenchSnapshot | null>;
  save(snapshot: WorkbenchSnapshot): Promise<void>;
  polish(payload: unknown): Promise<{ text: string; model: string; provider: string }>;
  integration(payload: unknown): Promise<IntegrationResult>;
  exportFile(payload: unknown): Promise<{ saved: boolean }>;
  backup(): Promise<{ saved: boolean }>;
}
