import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svg = readFileSync(resolve('prototype/brand/zhixu-c.svg')).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:512px;height:512px}</style><img src="data:image/svg+xml;base64,${svg}">`);
  await page.locator('img').evaluate(image => image.decode());
  const png = await page.screenshot({ omitBackground: true });
  writeFileSync(resolve('prototype/brand/zhixu.png'), png);
  mkdirSync(resolve('design-review'), { recursive: true });
  writeFileSync(resolve('design-review/zhixu-c.png'), png);

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    const encoded = await page.locator('img').evaluate((image, pixels) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = pixels;
      canvas.getContext('2d').drawImage(image, 0, 0, pixels, pixels);
      return canvas.toDataURL('image/png').split(',')[1];
    }, size);
    images.push(Buffer.from(encoded, 'base64'));
  }
  // ICO stores a directory followed by the PNG payload for each Windows icon size.
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  mkdirSync(resolve('build'), { recursive: true });
  writeFileSync(resolve('build/icon.ico'), Buffer.concat([header, ...images]));
  console.log('Rendered white C icon: SVG, 512px PNG and seven-size Windows ICO.');
} finally {
  await browser.close();
}
