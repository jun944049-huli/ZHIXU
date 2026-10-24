import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve('desktop-public');
mkdirSync(destination, { recursive: true });
for (const name of readdirSync(resolve('prototype'))) {
  if (/\.(js|css)$/.test(name) || name === 'remote-login.html') {
    copyFileSync(resolve('prototype', name), resolve(destination, name));
  }
}
cpSync(resolve('prototype/brand'), resolve(destination, 'brand'), { recursive: true });
const scripts = [
  'data.js', 'storage.js', 'shared.js', 'chat-format.js', 'views-core.js', 'views-chat.js',
  'views-project.js', 'views-output.js', 'modals.js', 'operations.js', 'work-sync.js', 'integrations.js',
  'features.js', 'analytics.js', 'documents.js', 'document-workflow.js', 'workspace.js', 'plugins.js', 'remote.js', 'updates.js', 'app.js'
];
writeFileSync(resolve(destination, 'workbench-bundle.js'),
  scripts.map(name => readFileSync(resolve('prototype', name), 'utf8')).join('\n;\n'));
