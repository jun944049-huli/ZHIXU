import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pluginSource, pluginManifest } from '../src/main/plugin-manifest';

test('plugin sources normalize npm, public GitHub and local folders without accepting commands or credentials', () => {
  assert.equal(pluginSource('@scope/mcp-tools@1.2.3'), '@scope/mcp-tools@1.2.3');
  assert.equal(pluginSource('https://github.com/example/mcp-tools.git'), 'https://codeload.github.com/example/mcp-tools/tar.gz/HEAD');
  assert.equal(pluginSource('https://github.com/example/mcp-tools/#feature/branch'), 'https://codeload.github.com/example/mcp-tools/tar.gz/feature%2Fbranch');
  for (const source of ['--global', 'npm install foo', 'https://user:secret@github.com/a/b',
    'http://example.org/plugin.tgz', 'file:../../private', 'foo;whoami', 'git+ssh://github.com/a/b'])
    assert.throws(() => pluginSource(source));
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-source-'));
  assert.throws(() => pluginSource(dir), /package.json/);
  writeFileSync(join(dir, 'package.json'), '{}');
  assert.equal(pluginSource(dir), dir);
});

test('plugin compatibility checks real built entries and rejects escaping paths and junctions', () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-manifest-'));
  const plugin = join(root, 'plugin');
  const outside = join(root, 'outside');
  mkdirSync(plugin); mkdirSync(outside);
  writeFileSync(join(plugin, 'index.js'), '');
  writeFileSync(join(outside, 'index.js'), '');
  const writePackage = (extra: object) => writeFileSync(join(plugin, 'package.json'), JSON.stringify({
    name: 'mcp-tools', version: '1.0.0', bin: 'index.js', ...extra
  }));
  writePackage({});
  assert.equal(pluginManifest(plugin).entry, 'index.js');
  writePackage({ bin: '../outside/index.js' });
  assert.throws(() => pluginManifest(plugin), /超出/);
  symlinkSync(outside, join(plugin, 'linked'), 'junction');
  writePackage({ bin: 'linked/index.js' });
  assert.throws(() => pluginManifest(plugin), /超出/);
  writePackage({ name: 'dsh-plugin-widget', bin: 'index.js' });
  assert.throws(() => pluginManifest(plugin), /需要适配/);
  writePackage({ name: 'my-internal-tool', zhixu: { apiVersion: 1, type: 'mcp', entry: 'index.js', args: ['a b'] } });
  assert.deepEqual(pluginManifest(plugin).args, ['a b']);
});
