export interface UpdateStatus {
  currentVersion: string;
  version: string;
  stage: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error' | 'unavailable';
  automatic: boolean;
  percent: number;
  checkedAt: string;
  hasToken: boolean;
  access: 'saved' | 'git' | 'none';
  message: string;
}
