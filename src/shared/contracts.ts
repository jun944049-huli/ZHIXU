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
  importDocument(payload: unknown): Promise<{ assetId: string; text: string; warnings: string[] }>;
  analyzeDocument(payload: unknown): Promise<DocumentAnalysis>;
  exportOriginal(payload: unknown): Promise<{ saved: boolean }>;
}

export const documentInputSchema = z.object({
  name: z.string().min(1).max(240),
  bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= 20 * 1024 * 1024,
    '文件须为 1 字节至 20 MB')
});

export const documentAnalysisSchema = z.object({
  summary: z.string().max(6000),
  projectId: z.string().max(150).nullable(),
  projectName: z.string().max(150),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    assignee: z.string().max(100),
    due: z.union([z.iso.date(), z.literal('')]),
    priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    estimateHours: z.number().min(0).max(200),
    evidence: z.string().trim().min(1).max(1000)
  })).max(80)
});
export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema> & {
  mode: string;
  warnings: string[];
};

export const analyzeDocumentSchema = z.object({
  text: z.string().trim().min(1).max(120000),
  name: z.string().min(1).max(240),
  today: z.iso.date(),
  instructions: z.string().max(4000),
  projects: z.array(z.object({ id: z.string().max(150), name: z.string().max(150) })).max(500),
  provider: polishSchema.omit({ text: true, tone: true }).optional()
});
