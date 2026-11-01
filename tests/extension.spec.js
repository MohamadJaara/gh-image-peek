import { test as base, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = fileURLToPath(new URL('../dist/chrome', import.meta.url));
const origin = 'https://github.com';
const prPath = '/acme/widget/pull/12';
const imageURL = (name) => `${origin}/user-attachments/assets/${name}.png`;
const preview = (id, name) => `<a id="${id}" href="${imageURL(name)}"><img src="${origin}/thumbnail.svg" alt="${name} screenshot"></a>`;
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Installed extension fixture</title>
  <style>body{margin:0;font:16px system-ui}main{padding:24px}.spacer{height:1000px}.markdown-body img{width:240px;height:160px}.after{height:2000px}</style>
  </head><body><main><h1>Pull request</h1><div class="spacer"></div>
  <section class="markdown-body">${preview('first', 'first')}${preview('second', 'second')}${preview('broken', 'broken')}</section>
  <div class="after"></div></main></body></html>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="#9333ea"/></svg>';

// Load the built package through Chromium, including its manifest, CSS and
// isolated content-script world. These tests deliberately never inject files.
const test = base.extend({
  page: async ({ headless }, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'gh-image-peek-extension-'));
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless,
        viewport: { width: 1280, height: 900 },
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });
      const page = context.pages()[0] || await context.newPage();
      await page.route(/^https:\/\/(?:github\.com|example\.org)\//, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/broken.png')) {
          await route.abort('failed');
        } else if (path.startsWith('/user-attachments/') || path === '/thumbnail.svg') {
          await route.fulfill({ contentType: 'image/svg+xml', body: svg });
        } else {
          await route.fulfill({ contentType: 'text/html', body: fixture });
        }
      });
      await use(page);
    } finally {
      try { await context?.close(); }
      finally { await rm(profile, { recursive: true, force: true }); }
    }
  },
});

const dialog = (page) => page.getByRole('dialog', { name: 'Image viewer', exact: true });
const picture = (page) => dialog(page).locator('[data-peek-image]');
const closeButton = (page) => dialog(page).getByRole('button', { name: 'Close image viewer', exact: true });

async function observeIgnoredClicks(page) {
  await page.evaluate(() => {
    window.ignoredClicks = [];
    window.observePeekClick = (event) => {
      window.ignoredClicks.push({ type: event.type, prevented: event.defaultPrevented });
      event.preventDefault();
    };
    // macOS Chromium reports Control-click as contextmenu rather than click.
    for (const type of ['click', 'auxclick', 'contextmenu']) document.addEventListener(type, window.observePeekClick, true);
  });
}

async function stopObservingClicks(page) {
  await page.evaluate(() => {
    for (const type of ['click', 'auxclick', 'contextmenu']) document.removeEventListener(type, window.observePeekClick, true);
  });
}

test('installed package opens with its stylesheet, zooms, and restores focus and scroll for every close method', async ({ page }) => {
  await page.goto(`${origin}${prPath}`);
  const opener = page.locator('#first');
  for (const method of ['Escape', 'button', 'backdrop']) {
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(0);
    await opener.click();
    await expect(picture(page)).toBeVisible();
    await expect(closeButton(page)).toBeFocused();
    const bounds = await dialog(page).boundingBox();
    expect(bounds).toEqual({ x: 0, y: 0, width: 1280, height: 900 });
    await dialog(page).getByRole('button', { name: 'Zoom presets', exact: true }).click();
    await dialog(page).getByRole('button', { name: '100% · actual size', exact: true }).click();
    expect(await picture(page).evaluate((image) => image.getBoundingClientRect().width)).toBe(2400);
    await page.keyboard.press('0');
    await expect(dialog(page)).toHaveAttribute('data-size', 'fit');
    if (method === 'Escape') await page.keyboard.press('Escape');
    else if (method === 'button') await closeButton(page).click();
    else await dialog(page).locator('[data-peek-stage]').click({ position: { x: 4, y: 4 } });
    await expect(dialog(page)).not.toBeVisible();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(before);
  }
});

test('installed script stays scoped to GitHub and handles SPA entry, newly loaded content, and navigation cleanup', async ({ page }) => {
  await page.goto(`https://example.org${prPath}`);
  await observeIgnoredClicks(page);
  await page.locator('#first').click();
  expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
  await expect(dialog(page)).not.toBeVisible();

  await page.goto(`${origin}/acme/widget`);
  await observeIgnoredClicks(page);
  await page.locator('#first').click();
  expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
  await expect(dialog(page)).not.toBeVisible();
  await stopObservingClicks(page);
  await page.evaluate(({ path, content }) => {
    history.pushState({}, '', path);
    document.querySelector('.markdown-body').insertAdjacentHTML('beforeend', content);
  }, { path: prPath, content: preview('late', 'late') });
  await page.locator('#late').click();
  await expect(picture(page)).toHaveAttribute('src', imageURL('late'));
  await expect(picture(page)).toBeVisible();
  await expect(dialog(page).locator('[data-peek-counter]')).toHaveText('4 / 4');

  await page.evaluate(() => {
    history.pushState({}, '', '/acme/widget/issues');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(dialog(page)).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  await page.evaluate((path) => history.pushState({}, '', path), prPath);
  await page.locator('#late').click();
  await expect(picture(page)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('installed viewer preserves modified clicks and recovers from a failed gallery image', async ({ page }) => {
  await page.goto(`${origin}${prPath}`);
  await observeIgnoredClicks(page);
  for (const modifier of ['Control', 'Meta', 'Shift', 'Alt']) {
    await page.evaluate(() => { window.ignoredClicks = []; });
    await page.locator('#first').click({ modifiers: [modifier] });
    expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
    await expect(dialog(page)).not.toBeVisible();
  }
  await page.evaluate(() => { window.ignoredClicks = []; });
  await page.locator('#first').click({ button: 'middle' });
  expect(await page.evaluate(() => window.ignoredClicks.at(-1))).toEqual({ type: 'auxclick', prevented: false });
  await expect(dialog(page)).not.toBeVisible();
  await stopObservingClicks(page);

  await page.locator('#broken').click();
  await expect(dialog(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('link', { name: 'Open original image', exact: true })).toHaveAttribute('href', imageURL('broken'));
  await expect(closeButton(page)).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Previous image', exact: true }).click();
  await expect(picture(page)).toHaveAttribute('src', imageURL('second'));
  await expect(picture(page)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#broken')).toBeFocused();
});
