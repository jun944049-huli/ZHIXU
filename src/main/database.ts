import { DatabaseSync } from 'node:sqlite';
import { snapshotSchema, type WorkbenchSnapshot } from '../shared/contracts';

export interface SettingsCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export class WorkbenchStore {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly codec: SettingsCodec) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workbench (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        task_key TEXT PRIMARY KEY, id TEXT NOT NULL, project_id TEXT,
        scheduled_date TEXT NOT NULL, bucket TEXT NOT NULL,
        title TEXT NOT NULL, done INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_by_date ON tasks(scheduled_date, done);
      CREATE INDEX IF NOT EXISTS tasks_by_project ON tasks(project_id);
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL
      );
      INSERT OR IGNORE INTO migrations VALUES (1, datetime('now'));
    `);
  }

  load(): WorkbenchSnapshot | null {
    const row = this.db.prepare('SELECT payload FROM workbench WHERE id = 1').get();
    if (!row) return null;
    const saved = JSON.parse(row.payload as string);
    if (saved.encryptedSettings) {
      saved.db.settings = JSON.parse(this.codec.decrypt(saved.encryptedSettings));
    }
    if (saved.encryptedPreferences) {
      saved.preferences['jw-settings'] = this.codec.decrypt(saved.encryptedPreferences);
    }
    return snapshotSchema.parse(saved);
  }

  save(input: unknown): void {
    const snapshot = snapshotSchema.parse(input);
    const stored = structuredClone(snapshot) as WorkbenchSnapshot & {
      encryptedSettings?: string;
      encryptedPreferences?: string;
    };
    if (stored.db.settings) {
      stored.encryptedSettings = this.codec.encrypt(JSON.stringify(stored.db.settings));
      delete stored.db.settings;
    }
    if (stored.preferences['jw-settings']) {
      stored.encryptedPreferences = this.codec.encrypt(stored.preferences['jw-settings']);
      delete stored.preferences['jw-settings'];
    }
    const payload = JSON.stringify(stored);
    if (Buffer.byteLength(payload) > 8_000_000) throw new Error('工作数据过大，保存已取消');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO workbench VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(payload, new Date().toISOString());
      this.db.exec('DELETE FROM projects; DELETE FROM tasks; DELETE FROM inbox;');
      const project = this.db.prepare('INSERT INTO projects VALUES (?, ?, ?)');
      for (const p of snapshot.db.projects) {
        project.run(p.id, String(p.name || ''), JSON.stringify(p));
      }
      const task = this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const addTask = (t: { id: string; [key: string]: unknown }, date: string, bucket: string) => {
        task.run(
          `${date}:${bucket}:${t.id}`, t.id, typeof t.project === 'string' ? t.project : null,
          date, bucket, String(t.title || ''), t.done ? 1 : 0, JSON.stringify(t)
        );
      };
      for (const bucket of ['must', 'should', 'could'] as const) {
        for (const t of snapshot.db.tasks[bucket]) addTask(t, snapshot.db.meta.today, bucket);
      }
      for (const [date, tasks] of Object.entries(snapshot.db.taskCalendar || {})) {
        if (date !== snapshot.db.meta.today) {
          for (const t of tasks) addTask(t, date, 'calendar');
        }
      }
      const inbox = this.db.prepare('INSERT INTO inbox VALUES (?, ?, ?)');
      for (const item of snapshot.db.inbox) {
        inbox.run(item.id, String(item.title || ''), JSON.stringify(item));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
