import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// PNGs are checked in; Chromium is needed only when updating the SVG artwork.
const icons = new URL('../extension/icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', icons), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`icon-${size}.png`, icons)), omitBackground: true });
  }
} finally {
  await browser.close();
}
