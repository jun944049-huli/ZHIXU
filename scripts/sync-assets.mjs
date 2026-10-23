import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve('desktop-public');
mkdirSync(destination, { recursive: true });
for (const name of readdirSync(resolve('prototype'))) {
  if (/\.(js|css)$/.test(name)) {
    copyFileSync(resolve('prototype', name), resolve(destination, name));
  }
}
cpSync(resolve('prototype/brand'), resolve(destination, 'brand'), { recursive: true });
