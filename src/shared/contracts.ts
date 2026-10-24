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
  protocol: z.enum(['auto', 'chat', 'responses']).default('auto'),
  model: z.string().trim().min(1).max(120).default('deepseek-chat'),
  provider: z.string().max(60).optional()
});

export interface DesktopAPI {
  load(): Promise<WorkbenchSnapshot | null>;
  save(snapshot: WorkbenchSnapshot): Promise<void>;
  polish(payload: unknown): Promise<{ text: string; model: string; provider: string }>;
  chat(payload: unknown): Promise<ChatResult>;
  providerModels(payload: unknown): Promise<{ models: string[]; endpoint: string }>;
  providerDiagnose(payload: unknown): Promise<ProviderDiagnosis>;
  integration(payload: unknown): Promise<IntegrationResult>;
  exportFile(payload: unknown): Promise<{ saved: boolean }>;
  backup(): Promise<{ saved: boolean }>;
  importDocument(payload: unknown): Promise<ImportedDocument>;
  reparseDocument(payload: unknown): Promise<ImportedDocument>;
  analyzeDocument(payload: unknown): Promise<DocumentAnalysis>;
  exportOriginal(payload: unknown): Promise<{ saved: boolean }>;
  workspace(payload: unknown): Promise<WorkspaceResult>;
  plugins(payload: unknown): Promise<unknown>;
  onWorkspaceEvent(listener: (event: WorkspaceEvent) => void): () => void;
}

export interface WorkspaceResult {
  canceled?: boolean;
  root?: { id: string; name: string; path: string };
  entries?: { name: string; path: string; directory: boolean }[];
  truncated?: boolean;
  text?: string;
  image?: string;
  binary?: boolean;
}
export interface WorkspaceEvent {
  type: 'browser' | 'terminal';
  url?: string;
  title?: string;
  loading?: boolean;
  canBack?: boolean;
  canForward?: boolean;
  error?: string;
  id?: string;
  text?: string;
  stream?: 'stdout' | 'stderr';
  started?: boolean;
  done?: boolean;
  closed?: boolean;
  exitCode?: number;
  cwd?: string;
}

export const providerSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().min(1).max(4096),
  model: z.string().trim().max(120).default(''),
  protocol: z.enum(['auto', 'chat', 'responses']).default('auto')
});
export type ProviderConfig = z.infer<typeof providerSchema>;
export interface ProviderCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  endpoint?: string;
  httpStatus?: number;
  durationMs?: number;
}
export interface ProviderDiagnosis {
  ok: boolean;
  checks: ProviderCheck[];
  models: string[];
  model: string;
  protocol?: 'chat' | 'responses';
  suggestion: string;
}

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT = 1_000_000;
export interface ImportedDocument {
  assetId: string;
  text: string;
  warnings: string[];
  parseError?: string;
}
export const documentInputSchema = z.object({
  name: z.string().min(1).max(240),
  bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= MAX_DOCUMENT_BYTES,
    '文件须为 1 字节至 50 MB')
});

export const documentAnalysisSchema = z.object({
  summary: z.string().max(6000),
  projectId: z.string().max(150).nullable(),
  projectName: z.string().max(150),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    details: z.string().max(12000).default(''),
    sourceTaskIds: z.array(z.string().min(1).max(150)).max(150).default([]),
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
  text: z.string().trim().min(1).max(MAX_DOCUMENT_TEXT),
  name: z.string().min(1).max(240),
  today: z.iso.date(),
  instructions: z.string().max(4000),
  projects: z.array(z.object({ id: z.string().max(150), name: z.string().max(150) })).max(500),
  existingTasks: z.array(z.object({
    id: z.string().min(1).max(150), title: z.string().max(500),
    details: z.string().max(12000).default(''), evidence: z.string().max(1000).default(''),
    assignee: z.string().max(100).default(''), due: z.string().max(40).default('')
  })).max(150).default([]),
  provider: polishSchema.omit({ text: true, tone: true }).optional()
});

const optionalDate = z.union([z.iso.date(), z.literal('')]).default('');
const projectReference = z.string().min(1).max(150).nullable().default(null);
const workTaskStatus = z.enum(['todo', 'doing', 'blocked', 'done']);
export const chatActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('work_update'), projectId: z.string().min(1).max(150),
    requiresConfirmation: z.boolean().default(false),
    tasks: z.array(z.object({ taskId: z.string().min(1).max(150), status: workTaskStatus,
      progress: z.number().int().min(0).max(100).optional() })).max(150).default([]),
    milestones: z.array(z.object({ milestoneId: z.string().min(1).max(150),
      status: z.enum(['open', 'risk', 'done']),
      taskIds: z.array(z.string().min(1).max(150)).min(1).max(150).optional()
    })).max(100).default([])
  }).refine(value => value.tasks.length + value.milestones.length > 0, '需要指定更新对象'),
  z.object({ type: z.literal('task'), projectId: projectReference, title: z.string().trim().min(1).max(200),
    due: optionalDate, date: optionalDate, assignee: z.string().max(100).default(''),
    estimateHours: z.number().min(0).max(200).default(0), priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']).default('P2') }),
  z.object({ type: z.literal('progress'), projectId: z.string().min(1).max(150),
    progress: z.number().int().min(0).max(100) }),
  z.object({ type: z.literal('risk'), projectId: z.string().min(1).max(150),
    title: z.string().trim().min(1).max(150), level: z.enum(['低', '中', '高']) }),
  z.object({ type: z.literal('capture'), projectId: projectReference, title: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('project'), name: z.string().trim().min(1).max(150),
    goal: z.string().max(2000).default(''), owner: z.string().max(100).default('') })
]);
export type ChatAction = z.infer<typeof chatActionSchema>;
export const chatRequestSchema = z.object({
  provider: providerSchema.extend({ name: z.string().max(60).default('自定义供应商') }),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(20000) })).min(1).max(24),
  context: z.object({
    today: z.iso.date(),
    selectedProjectId: projectReference,
    projects: z.array(z.object({ id: z.string().max(150), name: z.string().max(150) })).max(500),
    tasks: z.array(z.object({ id: z.string().max(150), projectId: projectReference,
      title: z.string().max(500), status: workTaskStatus,
      progress: z.number().min(0).max(100) })).max(500).default([]),
    milestones: z.array(z.object({ id: z.string().max(150), projectId: z.string().max(150),
      name: z.string().max(500), status: z.enum(['open', 'risk', 'done']),
      taskIds: z.array(z.string().max(150)).max(500).default([]) })).max(500).default([]),
    data: z.string().max(100000)
  })
});
export interface ChatResult {
  reply: string;
  actions: ChatAction[];
  model: string;
  provider: string;
  warnings: string[];
}
