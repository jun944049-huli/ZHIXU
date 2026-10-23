import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

export function pluginSource(source: string) {
  if (isAbsolute(source)) {
    if (!existsSync(join(source, 'package.json'))) throw new Error('本地目录中未找到 package.json，请选择插件项目的根目录');
    return resolve(source);
  }
  const github = source.match(/^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?(?:#([a-zA-Z0-9_./-]+))?$/);
  if (github) return `https://codeload.github.com/${github[1]}/${github[2]}/tar.gz/${github[3] ? encodeURIComponent(github[3]) : 'HEAD'}`;
  if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.*^~>=<|+-]+)?$/.test(source)) return source;
  throw new Error('请输入 npm 包名、公开的 GitHub 仓库地址或本地绝对目录。暂不支持私有仓库、压缩包和其他下载地址');
}

export function pluginContained(root: string, path: string) {
  const base = realpathSync(root);
  const target = realpathSync(path);
  const rel = relative(base, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('插件路径超出安装目录');
  return target;
}

export function pluginManifest(root: string): { name: string; version: string; entry: string; args: string[] } {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const file = join(root, 'zhixu.plugin.json');
  const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : pkg.zhixu;
  let entry: string;
  let args: string[] = [];
  if (manifest) {
    const value = z.object({ apiVersion: z.literal(1), type: z.literal('mcp'),
      entry: z.string().min(1), args: z.array(z.string().max(4000)).max(50).default([]) }).safeParse(manifest);
    if (!value.success) throw new Error('插件声明不兼容：需要 apiVersion: 1、type: "mcp" 和 JavaScript entry');
    entry = value.data.entry;
    args = value.data.args;
  } else {
    const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {});
    const descriptor = `${pkg.name} ${Array.isArray(pkg.keywords) ? pkg.keywords.join(' ') : ''} ${pkg.description || ''}`;
    if (!/\bmcp\b|modelcontextprotocol/i.test(descriptor) || bins.length !== 1 || typeof bins[0] !== 'string')
      throw new Error('此包不是可识别的 MCP 插件。需要单一 Node.js bin 入口，或提供 zhixu.plugin.json。其他应用专用插件需要适配');
    entry = bins[0];
  }
  const fullEntry = pluginContained(root, resolve(root, entry));
  if (!/\.(?:[cm]?js)$/i.test(fullEntry)) throw new Error('仅支持已构建的 JavaScript MCP 入口；请先构建 TypeScript/Python 等项目');
  return { name: z.string().min(1).max(200).parse(pkg.name), version: String(pkg.version || '0.0.0').slice(0, 100),
    entry: relative(root, fullEntry), args };
}
