// Clears rectangular regions (fractions of the image) from a PNG and re-trims it.
// usage: node tools/erase-region.mjs file.png x0,y0,x1,y1 [x0,y0,x1,y1 ...]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [file, ...rects] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<img id="i" src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}">`);
await page.waitForFunction(() => document.getElementById('i').complete);
const out = await page.evaluate((rects) => {
  const im = document.getElementById('i'), w = im.naturalWidth, h = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  for (const r of rects) { const [x0, y0, x1, y1] = r.split(',').map(Number); g.clearRect(Math.floor(x0 * w), Math.floor(y0 * h), Math.ceil((x1 - x0) * w), Math.ceil((y1 - y0) * h)); }
  const d = g.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const t = document.createElement('canvas'); t.width = maxX - minX + 1; t.height = maxY - minY + 1;
  t.getContext('2d').drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
  return { data: t.toDataURL('image/png'), w: t.width, h: t.height };
}, rects);
fs.writeFileSync(file, Buffer.from(out.data.split(',')[1], 'base64'));
console.log(file, out.w + 'x' + out.h);
await browser.close();
