const { cpSync, existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');

module.exports = async context => {
  const source = resolve(context.packager.projectDir, '.plugin-runtime');
  const target = join(context.appOutDir, 'resources', 'plugin-runtime');
  if (!existsSync(join(source, 'node_modules/npm/bin/npm-cli.js'))) {
    throw new Error('Plugin installer runtime is missing. Run npm run build before packaging.');
  }
  // electron-builder's generic resource filter omits root node_modules.
  cpSync(source, target, { recursive: true, dereference: true, force: true });
  createRequire(join(target, 'node_modules/npm/package.json')).resolve('graceful-fs');
};
