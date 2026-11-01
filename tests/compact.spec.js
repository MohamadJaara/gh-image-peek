import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../extension/content.js', import.meta.url));
const stylesheet = fileURLToPath(new URL('../extension/viewer.css', import.meta.url));
const origin = 'https://github.com';
const imageURL = (name) => `${origin}/user-attachments/assets/${name}.png`;
const longCaption = 'Screenshot of the updated meeting action sheet and review details '.repeat(12).trim();
const svg = (width = 360, height = 800) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#9333ea"/></svg>`;
const preview = (id, name, alt = name) => `<a id="${id}" href="${imageURL(name)}"><img src="${origin}/thumbnail.svg" alt="${alt}"></a>`;

async function setup(page, { body = `${preview('first', 'tall', longCaption)}${preview('second', 'next', 'Second screenshot')}`, slowImage } = {}) {
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/broken.png')) await route.abort('failed');
    else if (path.endsWith('/slow.png')) {
      if (slowImage) await slowImage;
      await route.fulfill({ contentType: 'image/svg+xml', body: svg() });
    } else if (path.startsWith('/user-attachments/') || path === '/thumbnail.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: svg() });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Compact viewer fixture</title>
        <style>body{margin:0;font:16px system-ui}main{padding:24px}.spacer{height:1000px}.markdown-body img{width:120px;height:200px}.after{height:2000px}</style>
        </head><body><main><h1>Pull request</h1><div class="spacer"></div><section class="markdown-body">${body}</section><div class="after"></div></main></body></html>` });
    }
  });
  await page.goto(`${origin}/acme/widget/pull/12`);
  await page.addStyleTag({ path: stylesheet });
  await page.addScriptTag({ path: script });
}

const dialog = (page) => page.getByRole('dialog', { name: 'Image viewer', exact: true });
const image = (page) => dialog(page).locator('[data-peek-image]');
const stage = (page) => dialog(page).locator('[data-peek-stage]');
const help = (page) => dialog(page).getByRole('button', { name: 'Keyboard shortcuts', exact: true });
const panel = (page) => dialog(page).locator('[data-peek-help-panel]');
const counter = (page) => dialog(page).locator('[data-peek-counter]');
const preset = (page) => dialog(page).getByRole('button', { name: 'Zoom presets', exact: true });
const next = (page) => dialog(page).getByRole('button', { name: 'Next image', exact: true });

async function open(page) {
  await page.locator('#first').click();
  await expect(image(page)).toBeVisible();
}

test('the header counter stays beside a truncated caption and announces each image position', async ({ page }) => {
  await setup(page);
  await open(page);
  await expect(counter(page)).toHaveText('1 / 2');
  await expect(counter(page)).toHaveAttribute('aria-label', 'Image 1 of 2');
  await expect(counter(page)).toHaveAttribute('role', 'status');
  await expect(counter(page)).toHaveAttribute('aria-live', 'polite');
  expect(await counter(page).evaluate((node) => Boolean(node.closest('[data-peek-toolbar]')))).toBe(true);
  const caption = dialog(page).getByText(longCaption, { exact: true });
  expect(await caption.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const captionBounds = await caption.boundingBox();
  const positionBounds = await counter(page).boundingBox();
  expect(positionBounds.x).toBeGreaterThanOrEqual(captionBounds.x + captionBounds.width);
  expect(Math.abs(positionBounds.y - captionBounds.y)).toBeLessThanOrEqual(3);
  await next(page).click();
  await expect(counter(page)).toHaveText('2 / 2');
  await expect(counter(page)).toHaveAttribute('aria-label', 'Image 2 of 2');
  await expect(image(page)).toHaveAttribute('alt', 'Second screenshot');
});

test('the tall image uses the full space below the unchanged desktop header', async ({ page }) => {
  await page.setViewportSize({ width: 1242, height: 891 });
  await setup(page);
  await open(page);
  await expect(dialog(page).locator('[data-peek-footer]')).toHaveCount(0);
  await expect(panel(page)).not.toBeVisible();
  const header = await dialog(page).locator('[data-peek-toolbar]').boundingBox();
  const viewport = await stage(page).boundingBox();
  const fitted = await image(page).boundingBox();
  expect(header.height).toBeLessThanOrEqual(76);
  expect(Math.abs(viewport.y - (header.y + header.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(viewport.y + viewport.height - 891)).toBeLessThanOrEqual(1);
  expect(Math.abs(fitted.y - viewport.y - 12)).toBeLessThanOrEqual(1);
  expect(Math.abs(viewport.y + viewport.height - fitted.y - fitted.height - 12)).toBeLessThanOrEqual(1);
  expect(fitted.height).toBeGreaterThan(780);
  // Opening help must not take layout space back from the image.
  await help(page).click();
  expect((await image(page).boundingBox()).height).toBeCloseTo(fitted.height, 1);
  expect((await dialog(page).locator('[data-peek-toolbar]').boundingBox()).height).toBe(header.height);
});

test('a single image hides only the counter and still offers shortcut help', async ({ page }) => {
  await setup(page, { body: preview('first', 'tall') });
  await open(page);
  await expect(counter(page)).not.toBeVisible();
  await expect(help(page)).toBeVisible();
  await help(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('[data-peek-scope]')).toContainText(/loaded.*PR page/i);
});

test('help is an accessible disclosure and Escape restores its trigger before closing the viewer', async ({ page }) => {
  await setup(page);
  await open(page);
  await expect(help(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(help(page)).toHaveAttribute('aria-controls', 'gh-image-peek-help-panel');
  await help(page).focus();
  await page.keyboard.press('Enter');
  await expect(help(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog(page).getByRole('region', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
  await expect(panel(page)).toContainText('Ctrl');
  await expect(panel(page)).toContainText('100%');
  await expect(panel(page).locator('[data-peek-scope]')).toContainText(/loaded.*PR page/i);
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await expect(help(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(help(page)).toBeFocused();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.locator('#first')).toBeFocused();
});

test('help and zoom presets are mutually exclusive and gallery navigation closes disclosures', async ({ page }) => {
  await setup(page);
  await open(page);
  await help(page).click();
  await preset(page).click();
  await expect(panel(page)).not.toBeVisible();
  await expect(help(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog(page).locator('[data-peek-presets]')).toBeVisible();
  await help(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(dialog(page).locator('[data-peek-presets]')).not.toBeVisible();
  await expect(preset(page)).toHaveAttribute('aria-expanded', 'false');
  await next(page).click();
  await expect(counter(page)).toHaveText('2 / 2');
  await expect(panel(page)).not.toBeVisible();
  await expect(help(page)).toHaveAttribute('aria-expanded', 'false');
});

test('outside image clicks dismiss help without stealing focus, and backdrop clicks retain dismissal', async ({ page }) => {
  await setup(page);
  await open(page);
  await help(page).click();
  await image(page).click();
  await expect(panel(page)).not.toBeVisible();
  await expect(stage(page)).toBeFocused();
  await expect(dialog(page)).toBeVisible();
  await help(page).click();
  await stage(page).click({ position: { x: 4, y: 4 } });
  await expect(dialog(page)).not.toBeVisible();
});

test('open help prevents background gallery and single-character zoom shortcuts', async ({ page }) => {
  await setup(page);
  await open(page);
  await help(page).click();
  // Programmatic focus leaves the disclosure open, unlike an outside click.
  await stage(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('1');
  await page.keyboard.press('+');
  await expect(counter(page)).toHaveText('1 / 2');
  await expect(preset(page)).toHaveText('Fit ▾');
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help(page)).toBeFocused();
});

test('Tab navigation keeps focus inside the modal and skips hidden help and preset content', async ({ page }) => {
  await setup(page);
  await open(page);
  for (const expanded of [false, true]) {
    if (expanded) await help(page).click();
    for (let step = 0; step < 16; step += 1) {
      await page.keyboard.press(step < 8 ? 'Tab' : 'Shift+Tab');
      const focused = await dialog(page).evaluate((node) => ({
        inside: node.contains(document.activeElement),
        hidden: Boolean(document.activeElement.closest('[hidden]')),
        disabled: document.activeElement.disabled === true,
      }));
      expect(focused).toEqual({ inside: true, hidden: false, disabled: false });
    }
  }
});

test('loading and failed images retain help and an accessible error in the image area', async ({ page }) => {
  let release;
  const slowImage = new Promise((resolve) => { release = resolve; });
  await setup(page, { body: `${preview('first', 'slow')}${preview('second', 'broken')}`, slowImage });
  try {
    await page.locator('#first').click();
    await expect(dialog(page).getByText('Loading image…', { exact: true })).toBeVisible();
    await expect(help(page)).toBeEnabled();
    await help(page).click();
    await expect(panel(page)).toBeVisible();
    await next(page).click();
    await expect(stage(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
    await expect(help(page)).toBeEnabled();
    await help(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('[data-peek-help]')).toContainText(/original/i);
    await expect(dialog(page).getByRole('link', { name: 'Open original image', exact: true })).toBeEnabled();
  } finally { release(); }
});

for (const width of [320, 390]) {
  test(`the ${width}px header keeps two rows, readable position, and usable controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await setup(page);
    await open(page);
    const header = await dialog(page).locator('[data-peek-toolbar]').boundingBox();
    const close = await dialog(page).getByRole('button', { name: 'Close image viewer', exact: true }).boundingBox();
    const helpButton = await help(page).boundingBox();
    const zoom = await dialog(page).locator('[data-peek-zoom]').boundingBox();
    const original = await dialog(page).getByRole('link', { name: 'Open original image', exact: true }).boundingBox();
    expect(header.height).toBeLessThanOrEqual(124);
    expect(Math.abs(close.y - helpButton.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(zoom.y - original.y)).toBeLessThanOrEqual(2);
    expect(zoom.y).toBeGreaterThanOrEqual(close.y + close.height);
    for (const locator of [help(page), counter(page), preset(page), next(page)]) {
      await expect(locator).toBeVisible();
      const bounds = await locator.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    expect(helpButton.width).toBeGreaterThanOrEqual(44);
    expect(helpButton.height).toBeGreaterThanOrEqual(44);
    const viewport = await stage(page).boundingBox();
    const fitted = await image(page).boundingBox();
    expect(fitted.x).toBeGreaterThanOrEqual(viewport.x);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(700 - 8 + 1);
    await help(page).click();
    const popup = await panel(page).boundingBox();
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width);
    expect(popup.y + popup.height).toBeLessThanOrEqual(700);
  });
}

test('shortcut help stays inside a short viewport and scrolls to reveal its full content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await setup(page);
  await open(page);
  await help(page).click();
  const popup = await panel(page).boundingBox();
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.y).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(320);
  expect(popup.y + popup.height).toBeLessThanOrEqual(400);
  expect(await panel(page).evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await panel(page).evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect.poll(() => panel(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(help(page)).toBeFocused();
});
