import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../extension/content.js', import.meta.url));
const stylesheet = fileURLToPath(new URL('../extension/viewer.css', import.meta.url));
const origin = 'https://github.com';
const imageURL = (name) => `${origin}/user-attachments/assets/${name}.png`;
const preview = (id, name) => `<a id="${id}" href="${imageURL(name)}"><img src="${origin}/thumbnail.svg" alt="${name} screenshot"></a>`;
const svg = (width = 2400, height = 1600) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#9333ea"/><circle cx="50%" cy="50%" r="80" fill="white"/></svg>`;

async function setup(page, { body = `${preview('first', 'large')}${preview('second', 'next')}`, slowImage } = {}) {
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/broken.png')) {
      await route.abort('failed');
    } else if (path.endsWith('/slow.png')) {
      if (slowImage) await slowImage;
      await route.fulfill({ contentType: 'image/svg+xml', body: svg() });
    } else if (path.startsWith('/user-attachments/') || path === '/thumbnail.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: path.endsWith('/small.png') ? svg(160, 100) : svg() });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zoom fixture</title>
        <style>body{margin:0;font:16px system-ui}main{padding:24px}.spacer{height:1000px}.markdown-body img{width:240px;height:160px}.after{height:2000px}</style>
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
const preset = (page) => dialog(page).getByRole('button', { name: 'Zoom presets', exact: true });
const zoomIn = (page) => dialog(page).getByRole('button', { name: 'Zoom in', exact: true });
const zoomOut = (page) => dialog(page).getByRole('button', { name: 'Zoom out', exact: true });
const scale = (page) => image(page).evaluate((node) => node.getBoundingClientRect().width / node.naturalWidth);

async function open(page, selector = '#first') {
  await page.locator(selector).click();
  await expect(image(page)).toBeVisible();
}

async function choose(page, name) {
  await preset(page).click();
  await dialog(page).getByRole('button', { name, exact: true }).click();
}

async function wheel(locator, options = {}) {
  return locator.evaluate((node, values) => {
    const rect = node.getBoundingClientRect();
    const viewport = (node.closest('[data-peek-stage]') || node).getBoundingClientRect();
    const left = Math.max(rect.left, viewport.left);
    const top = Math.max(rect.top, viewport.top);
    const event = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100,
      clientX: left + Math.min((Math.min(rect.right, viewport.right) - left) / 2, 200),
      clientY: top + Math.min((Math.min(rect.bottom, viewport.bottom) - top) / 2, 200),
      ...values,
    });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  }, options);
}

test('compact controls expose Fit, exact actual size, larger presets, and zoom limits', async ({ page }) => {
  await setup(page);
  await open(page);
  const fitted = await scale(page);
  await expect(preset(page)).toHaveText('Fit ▾');
  await expect(zoomOut(page)).toBeDisabled();
  await zoomIn(page).click();
  await expect.poll(() => scale(page)).toBeGreaterThan(fitted);
  await expect(zoomIn(page)).toBeFocused();
  await choose(page, '100% · actual size');
  expect(await scale(page)).toBeCloseTo(1, 3);
  await expect(stage(page)).toBeFocused();
  await expect(preset(page)).toHaveText('100% ▾');
  await choose(page, '200%');
  expect(await scale(page)).toBeCloseTo(2, 3);
  await choose(page, '400%');
  expect(await scale(page)).toBeCloseTo(4, 3);
  await expect(zoomIn(page)).toBeDisabled();
  await choose(page, 'Fit to window');
  await expect(dialog(page)).toHaveAttribute('data-size', 'fit');
  expect(await scale(page)).toBeCloseTo(fitted, 3);
  await expect(zoomOut(page)).toBeDisabled();
});

test('zoom controls stay disabled during loading and failure, with gallery recovery available', async ({ page }) => {
  let release;
  const slowImage = new Promise((resolve) => { release = resolve; });
  await setup(page, { slowImage, body: `${preview('slow', 'slow')}${preview('broken', 'broken')}${preview('last', 'large')}` });
  try {
    await page.locator('#slow').click();
    await expect(dialog(page).getByText('Loading image…', { exact: true })).toBeVisible();
    for (const control of [zoomIn(page), zoomOut(page), preset(page)]) await expect(control).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Next image', exact: true }).click();
    await expect(dialog(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
    for (const control of [zoomIn(page), zoomOut(page), preset(page)]) await expect(control).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Next image', exact: true }).click();
    await expect(image(page)).toBeVisible();
    await expect(preset(page)).toBeEnabled();
    await expect(zoomIn(page)).toBeEnabled();
  } finally { release(); }
});

test('single-character shortcuts activate only in the focused image area', async ({ page }) => {
  await setup(page);
  await open(page);
  const fitted = await scale(page);
  await page.keyboard.press('1');
  expect(await scale(page)).toBeCloseTo(fitted, 3);
  await image(page).click();
  await expect(stage(page)).toBeFocused();
  await page.keyboard.press('1');
  expect(await scale(page)).toBeCloseTo(1, 3);
  await page.keyboard.press('Shift+=');
  await expect.poll(() => scale(page)).toBeGreaterThan(1);
  await page.keyboard.press('-');
  await expect.poll(() => scale(page)).toBeLessThan(1.5);
  await page.keyboard.press('0');
  await expect(preset(page)).toHaveText('Fit ▾');
  expect(await scale(page)).toBeCloseTo(fitted, 3);
  await page.getByRole('button', { name: 'Close image viewer', exact: true }).focus();
  await page.keyboard.press('=');
  expect(await scale(page)).toBeCloseTo(fitted, 3);
});

test('browser modifier combinations and composing keys are not consumed by image zoom', async ({ page }) => {
  await setup(page);
  await open(page);
  await image(page).click();
  const fitted = await scale(page);
  for (const values of [
    { key: '+', ctrlKey: true }, { key: '-', ctrlKey: true }, { key: '0', ctrlKey: true },
    { key: '+', metaKey: true }, { key: '-', metaKey: true }, { key: '0', metaKey: true },
    { key: '1', altKey: true }, { key: '+', isComposing: true },
  ]) {
    const prevented = await stage(page).evaluate((node, options) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, values);
    expect(prevented).toBe(false);
    expect(await scale(page)).toBeCloseTo(fitted, 3);
  }
});

test('a previously prevented shortcut does not modify the image', async ({ page }) => {
  await setup(page);
  await open(page);
  await image(page).click();
  const fitted = await scale(page);
  const prevented = await stage(page).evaluate((node) => {
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true });
    event.preventDefault();
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  expect(await scale(page)).toBeCloseTo(fitted, 3);
});

test('Ctrl-wheel zoom keeps the image point beneath the cursor anchored', async ({ page }) => {
  await setup(page);
  await open(page);
  await choose(page, '100% · actual size');
  const rect = await stage(page).boundingBox();
  const anchor = { x: rect.x + rect.width * .6, y: rect.y + rect.height * .55 };
  const before = await image(page).boundingBox();
  const oldScale = await scale(page);
  const pixel = { x: (anchor.x - before.x) / oldScale, y: (anchor.y - before.y) / oldScale };
  expect(await wheel(image(page), { clientX: anchor.x, clientY: anchor.y })).toBe(true);
  await expect.poll(() => scale(page)).toBeGreaterThan(oldScale);
  const after = await image(page).boundingBox();
  const newScale = await scale(page);
  expect(Math.abs(after.x + pixel.x * newScale - anchor.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y + pixel.y * newScale - anchor.y)).toBeLessThanOrEqual(2);
  await expect(stage(page)).toBeFocused();
});

test('wheel interception is limited to cancelable Ctrl-wheel directly over the loaded image', async ({ page }) => {
  await setup(page);
  await open(page);
  const fitted = await scale(page);
  for (const values of [
    { ctrlKey: false }, { ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true },
    { ctrlKey: true, shiftKey: true }, { cancelable: false }, { deltaY: 0, deltaX: -100 },
  ]) {
    expect(await wheel(image(page), values)).toBe(false);
    expect(await scale(page)).toBeCloseTo(fitted, 3);
  }
  for (const locator of [stage(page), dialog(page).locator('[data-peek-toolbar]'), preset(page)]) {
    expect(await wheel(locator)).toBe(false);
    expect(await scale(page)).toBeCloseTo(fitted, 3);
  }
  await choose(page, '400%');
  expect(await wheel(image(page))).toBe(true);
  expect(await scale(page)).toBeCloseTo(4, 3);
  await choose(page, 'Fit to window');
  expect(await wheel(image(page), { deltaY: 100 })).toBe(true);
  expect(await scale(page)).toBeCloseTo(fitted, 3);
});

test('pixel, line, and page wheel deltas stay bounded and invalid deltas are ignored', async ({ page }) => {
  await setup(page);
  await open(page);
  for (const deltaMode of [0, 1, 2]) {
    await choose(page, '100% · actual size');
    expect(await wheel(image(page), { deltaMode, deltaY: -1 })).toBe(true);
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    expect(await scale(page)).toBeLessThanOrEqual(4);
  }
  await choose(page, '100% · actual size');
  expect(await wheel(image(page), { deltaY: -1e9 })).toBe(true);
  await expect.poll(() => scale(page)).toBeGreaterThan(1);
  expect(await scale(page)).toBeLessThanOrEqual(4);
  const before = await scale(page);
  const prevented = await image(page).evaluate((node) => {
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'deltaY', { value: Number.NaN });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(await scale(page)).toBeCloseTo(before, 3);
});

test('ordinary wheel input pans an overflowing image without changing its zoom', async ({ page }) => {
  await setup(page);
  await open(page);
  await choose(page, '100% · actual size');
  await stage(page).evaluate((node) => node.scrollTo(100, 100));
  const before = await stage(page).evaluate((node) => node.scrollTop);
  const bounds = await stage(page).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 150);
  await expect.poll(() => stage(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(before);
  expect(await scale(page)).toBeCloseTo(1, 3);
});

test('double-click toggles Fit and actual size while modified double-clicks stay untouched', async ({ page }) => {
  await setup(page);
  await open(page);
  const fitted = await scale(page);
  await image(page).dblclick();
  expect(await scale(page)).toBeCloseTo(1, 3);
  await image(page).dblclick({ position: { x: 100, y: 100 } });
  await expect(dialog(page)).toHaveAttribute('data-size', 'fit');
  expect(await scale(page)).toBeCloseTo(fitted, 3);
  for (const values of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const prevented = await image(page).evaluate((node, options) => {
      const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, ...options });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, values);
    expect(prevented).toBe(false);
    expect(await scale(page)).toBeCloseTo(fitted, 3);
  }
});

test('mouse drag pans the zoomed image and releases capture without closing the viewer', async ({ page }) => {
  await setup(page);
  await open(page);
  await choose(page, '100% · actual size');
  await stage(page).evaluate((node) => node.scrollTo(300, 250));
  const viewport = await stage(page).boundingBox();
  const start = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 90, start.y - 60, { steps: 4 });
  await expect.poll(() => stage(page).evaluate((node) => node.scrollLeft)).toBeGreaterThan(370);
  await expect.poll(() => stage(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(295);
  await page.mouse.up();
  const finished = await stage(page).evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop }));
  await page.mouse.move(start.x + 50, start.y + 50);
  expect(await stage(page).evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual(finished);
  await expect(dialog(page)).toBeVisible();
  await expect(image(page)).toHaveAttribute('draggable', 'false');
  await expect(stage(page)).toBeFocused();
});

test('resizing refits the image while preserving explicit manual zoom', async ({ page }) => {
  await setup(page);
  await open(page);
  const before = await scale(page);
  await page.setViewportSize({ width: 700, height: 650 });
  await expect.poll(() => scale(page)).toBeLessThan(before);
  await expect(preset(page)).toHaveText('Fit ▾');
  await choose(page, '200%');
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(() => scale(page)).toBeCloseTo(2, 3);
  await expect(preset(page)).toHaveText('200% ▾');
});

test('small images are never enlarged in Fit and explicit actual size remains inspection mode', async ({ page }) => {
  await setup(page, { body: `${preview('first', 'small')}${preview('second', 'large')}` });
  await open(page);
  expect(await scale(page)).toBeCloseTo(1, 3);
  await expect(preset(page)).toHaveText('Fit ▾');
  await choose(page, '100% · actual size');
  await expect(dialog(page)).toHaveAttribute('data-size', 'actual');
  await page.keyboard.press('ArrowRight');
  await expect(dialog(page).locator('[data-peek-counter]')).toHaveText('1 of 2');
  await expect(image(page)).toHaveAttribute('src', imageURL('small'));
});

test('gallery changes reset custom zoom and closing restores the original opener and scroll', async ({ page }) => {
  await setup(page);
  const opener = page.locator('#first');
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await open(page);
  await choose(page, '200%');
  await dialog(page).getByRole('button', { name: 'Next image', exact: true }).click();
  await expect(image(page)).toHaveAttribute('src', imageURL('next'));
  await expect(image(page)).toBeVisible();
  await expect(preset(page)).toHaveText('Fit ▾');
  await expect(dialog(page)).toHaveAttribute('data-size', 'fit');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
});

test('preset disclosure is keyboard accessible and Escape first dismisses it', async ({ page }) => {
  await setup(page);
  await open(page);
  await preset(page).focus();
  await page.keyboard.press('Enter');
  await expect(preset(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog(page).locator('[data-peek-presets]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-peek-presets]')).not.toBeVisible();
  await expect(preset(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(preset(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
});

for (const width of [320, 390]) {
  test(`zoom controls and presets fit a ${width}px viewport without hiding gallery arrows`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await setup(page);
    await open(page);
    for (const control of await dialog(page).locator('[data-peek-toolbar] button:not([hidden]), [data-peek-toolbar] a, [data-peek-nav]').all()) {
      if (!await control.isVisible()) continue;
      const bounds = await control.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
    }
    await preset(page).click();
    const popup = await dialog(page).locator('[data-peek-presets]').boundingBox();
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width);
    await dialog(page).getByRole('button', { name: '400%', exact: true }).click();
    await expect(dialog(page).getByRole('button', { name: 'Previous image', exact: true })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Next image', exact: true })).toBeVisible();
  });
}
