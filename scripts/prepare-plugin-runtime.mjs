import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const modules = join(root, 'node_modules');
const target = join(root, '.plugin-runtime');
if (dirname(target) !== root || target === root) throw new Error('Invalid runtime staging directory');
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, 'node_modules'), { recursive: true });
const visited = new Set();
const copied = [];
function packageDirectory(from, name) {
  const require = createRequire(join(from, 'package.json'));
  try { return dirname(require.resolve(name + '/package.json')); }
  catch {
    let candidate = dirname(require.resolve(name));
    while (candidate !== dirname(candidate)) {
      const file = join(candidate, 'package.json');
      if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === name) return candidate;
      candidate = dirname(candidate);
    }
    throw new Error(`Cannot find dependency ${name}`);
  }
}
function collect(directory) {
  directory = realpathSync(directory);
  if (visited.has(directory)) return;
  visited.add(directory);
  const rel = relative(modules, directory);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Dependency outside node_modules');
  if (!copied.some(parent => directory === parent || directory.startsWith(parent + sep))) {
    cpSync(directory, join(target, 'node_modules', rel), { recursive: true, dereference: true });
    copied.push(directory);
  }
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const name of Object.keys(pkg.dependencies || {})) collect(packageDirectory(directory, name));
  for (const name of Object.keys(pkg.optionalDependencies || {})) {
    try { collect(packageDirectory(directory, name)); }
    catch (error) {
      if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
  }
}
collect(packageDirectory(root, 'npm'));
// npm bundles an older copy; its runtime uses the pinned patched version.
const patched = packageDirectory(root, 'ip-address');
const patchTarget = join(target, 'node_modules/npm/node_modules/ip-address');
cpSync(patched, patchTarget, { recursive: true, force: true });
console.log(`Plugin installer runtime prepared (${visited.size} dependency locations).`);
