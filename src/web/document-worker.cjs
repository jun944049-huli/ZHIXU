const { parentPort, workerData } = require('node:worker_threads');
require('tsx/cjs');
const { parseDocument } = require('../main/document-parser.ts');
parseDocument(workerData).then(
  result => parentPort.postMessage({ result }),
  error => parentPort.postMessage({ error: error.message || '文档解析失败' })
);
