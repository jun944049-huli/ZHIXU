import { parentPort, workerData } from 'node:worker_threads';
import { parseDocument } from './document-parser';

void parseDocument(workerData).then(
  result => parentPort?.postMessage({ result }),
  error => parentPort?.postMessage({ error: error.message || '文档解析失败' })
);
