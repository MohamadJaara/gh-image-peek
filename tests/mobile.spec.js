import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../extension/content.js', import.meta.url));
const stylesheet = fileURLToPath(new URL('../extension/viewer.css', import.meta.url));
const origin = 'https://github.com';
const imageURL = (name) => `${origin}/user-attachments/assets/${name}.png`;
const preview = (id, name) => `<a id="${id}" href="${imageURL(name)}"><img src="${origin}/thumbnail.svg" alt="${name} screenshot"></a>`;
const svg = (width = 2400, height = 1200) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#9333ea"/></svg>`;

async function setup(page) {
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/broken.png')) await route.abort('failed');
    else if (path.startsWith('/user-attachments/') || path === '/thumbnail.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: path.endsWith('/tall.png') ? svg(1200, 2400) : svg() });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>Touch viewer fixture</title>
        <style>body{margin:0;font:16px system-ui}main{padding:16px}.spacer{height:1000px}.markdown-body a{display:inline-block;margin:4px}.markdown-body img{width:120px;height:80px}.after{height:1800px}</style>
        </head><body><main><h1>Pull request</h1><div class="spacer"></div><section class="markdown-body">
        ${preview('first', 'wide')}${preview('second', 'tall')}${preview('broken', 'broken')}
        </section><div class="after"></div></main></body></html>` });
    }
  });
  await page.goto(`${origin}/acme/widget/pull/12`);
  await page.addStyleTag({ path: stylesheet });
  await page.addScriptTag({ path: script });
}

const viewer = (page) => page.getByRole('dialog', { name: 'Image viewer', exact: true });
const image = (page) => viewer(page).locator('[data-peek-image]');
const stage = (page) => viewer(page).locator('[data-peek-stage]');
const zoom = (page) => viewer(page).getByRole('button', { name: 'Zoom presets', exact: true });
const help = (page) => viewer(page).getByRole('button', { name: 'Keyboard shortcuts', exact: true });
const close = (page) => viewer(page).getByRole('button', { name: 'Close image viewer', exact: true });

async function open(page) {
  await page.locator('#first').tap();
  await expect(image(page)).toBeVisible();
}

async function expectInsideViewport(page, locator) {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function touch(page, type, id, point) {
  await image(page).dispatchEvent(type, {
    pointerType: 'touch', pointerId: id, isPrimary: id === 1,
    button: 0, buttons: ['pointerup', 'pointercancel'].includes(type) ? 0 : 1,
    clientX: point.x, clientY: point.y,
  });
}

async function stageCenter(page) {
  const bounds = await stage(page).boundingBox();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function startPinch(page, center, distance = 100) {
  await touch(page, 'pointerdown', 1, { x: center.x - distance / 2, y: center.y });
  await touch(page, 'pointerdown', 2, { x: center.x + distance / 2, y: center.y });
}

async function spreadPinch(page, center, distance) {
  await touch(page, 'pointermove', 1, { x: center.x - distance / 2, y: center.y });
  await touch(page, 'pointermove', 2, { x: center.x + distance / 2, y: center.y });
}

async function endPinch(page, center) {
  await touch(page, 'pointerup', 1, center);
  await touch(page, 'pointerup', 2, center);
}

async function chooseActualSize(page) {
  await zoom(page).tap();
  await viewer(page).getByRole('button', { name: '100% · actual size', exact: true }).tap();
}

async function intrinsicPoint(page, point) {
  return image(page).evaluate((node, anchor) => {
    const bounds = node.getBoundingClientRect();
    const scale = bounds.width / node.naturalWidth;
    return { x: (anchor.x - bounds.x) / scale, y: (anchor.y - bounds.y) / scale };
  }, point);
}

test('touch opening and both on-screen close methods keep the PR position and original focus', async ({ page }) => {
  await setup(page);
  const opener = page.locator('#first');
  for (const method of ['button', 'backdrop']) {
    await opener.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    expect(before.y).toBeGreaterThan(0);
    await open(page);
    if (method === 'button') await close(page).tap();
    else await stage(page).tap({ position: { x: page.viewportSize().width / 2, y: 4 } });
    await expect(viewer(page)).not.toBeVisible();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
  }
});

for (const width of [320, 390]) {
  test(`a ${width}px touch viewport gives a wide image the screen width and keeps controls tappable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await setup(page);
    await open(page);
    const fitted = await image(page).boundingBox();
    expect(fitted.width).toBeGreaterThanOrEqual(width - 32);
    await expectInsideViewport(page, image(page));
    for (const control of await viewer(page).locator('button, a').all()) {
      if (!await control.isVisible()) continue;
      const bounds = await control.boundingBox();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await expectInsideViewport(page, control);
    }
    await viewer(page).getByRole('button', { name: 'Next image', exact: true }).tap();
    await expect(image(page)).toHaveAttribute('src', imageURL('tall'));
    await expect(image(page)).toBeVisible();
    await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('2 / 3');
    await close(page).tap();
  });
}

for (const size of [{ width: 390, height: 700 }, { width: 320, height: 280 }, { width: 640, height: 280 }]) {
  test(`help and every zoom preset stay reachable at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await setup(page);
    await open(page);
    await zoom(page).tap();
    const presets = viewer(page).locator('[data-peek-presets]');
    await expectInsideViewport(page, presets);
    await viewer(page).getByRole('button', { name: '400%', exact: true }).tap();
    await expect(zoom(page)).toHaveText('400% ▾');
    await zoom(page).tap();
    await viewer(page).getByRole('button', { name: 'Fit to window', exact: true }).tap();
    await expect(viewer(page)).toHaveAttribute('data-size', 'fit');
    await help(page).tap();
    const panel = viewer(page).locator('[data-peek-help-panel]');
    await expect(panel).toBeVisible();
    await expectInsideViewport(page, panel);
    await expect(panel).toContainText(/swipe/i);
    // Scrollable help must expose its final scope note even on short screens.
    const scope = panel.locator('[data-peek-scope]');
    await scope.scrollIntoViewIfNeeded();
    await expectInsideViewport(page, scope);
    if (size.height === 280) expect(await panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await help(page).tap();
    await expect(panel).not.toBeVisible();
    await close(page).tap();
  });
}

test('orientation and browser-height changes refit an open image without discarding manual zoom', async ({ page }) => {
  await setup(page);
  await open(page);
  const portraitWidth = (await image(page).boundingBox()).width;
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await image(page).boundingBox()).width).toBeGreaterThan(portraitWidth);
  await expectInsideViewport(page, image(page));
  await zoom(page).tap();
  await viewer(page).getByRole('button', { name: '100% · actual size', exact: true }).tap();
  await expect.poll(() => image(page).evaluate((node) => node.getBoundingClientRect().width)).toBe(2400);
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(viewer(page)).toHaveAttribute('data-size', 'actual');
  expect(await image(page).evaluate((node) => node.getBoundingClientRect().width)).toBe(2400);
  expect(await stage(page).evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expectInsideViewport(page, close(page));
  await close(page).tap();
});

test('touch help describes image pinching while the surrounding stage keeps native browser gestures', async ({ page }) => {
  await setup(page);
  await open(page);
  const fittedPolicy = await stage(page).evaluate((node) => getComputedStyle(node).touchAction);
  expect(fittedPolicy).toContain('pan-y');
  expect(fittedPolicy).toContain('pinch-zoom');
  expect(await image(page).evaluate((node) => getComputedStyle(node).touchAction)).toBe('none');
  await help(page).tap();
  await expect(viewer(page).locator('[data-peek-help-panel]')).toContainText(/swipe/i);
  await expect(viewer(page).locator('[data-peek-help-panel]')).toContainText(/pinch/i);
  await help(page).tap();
  await zoom(page).tap();
  await viewer(page).getByRole('button', { name: '100% · actual size', exact: true }).tap();
  expect(await stage(page).evaluate((node) => getComputedStyle(node).touchAction)).toBe('auto');
  expect(await image(page).evaluate((node) => getComputedStyle(node).touchAction)).toBe('none');
  await close(page).tap();
});

test('a failed image retains touch exits and can be skipped using the gallery controls', async ({ page }) => {
  await setup(page);
  await page.locator('#broken').tap();
  await expect(viewer(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
  await expect(viewer(page).getByRole('link', { name: 'Open original image', exact: true })).toHaveAttribute('href', imageURL('broken'));
  await expect(close(page)).toBeEnabled();
  await viewer(page).getByRole('button', { name: 'Previous image', exact: true }).tap();
  await expect(image(page)).toHaveAttribute('src', imageURL('tall'));
  await expect(image(page)).toBeVisible();
  await expect(zoom(page)).toBeEnabled();
  await close(page).tap();
  await expect(page.locator('#broken')).toBeFocused();
});

test('image pinch zoom preserves the intrinsic midpoint and never zooms the page', async ({ page }) => {
  await setup(page);
  await open(page);
  await chooseActualSize(page);
  const midpoint = await stageCenter(page);
  midpoint.x += 20;
  midpoint.y -= 20;
  const before = await intrinsicPoint(page, midpoint);
  const pageScale = await page.evaluate(() => visualViewport.scale);
  await startPinch(page, midpoint);
  await spreadPinch(page, midpoint, 200);
  await expect(zoom(page)).toHaveText('200% ▾');
  const after = await intrinsicPoint(page, midpoint);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(pageScale);
  await expectInsideViewport(page, close(page));
  await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('1 / 3');
  await endPinch(page, midpoint);
  await close(page).tap();
});

test('image pinch stays between Fit and 400 percent', async ({ page }) => {
  await setup(page);
  await open(page);
  const fitWidth = (await image(page).boundingBox()).width;
  const midpoint = await stageCenter(page);
  await startPinch(page, midpoint);
  await spreadPinch(page, midpoint, 100_000);
  await expect(zoom(page)).toHaveText('400% ▾');
  expect(await image(page).evaluate((node) => node.getBoundingClientRect().width)).toBe(9600);
  await endPinch(page, midpoint);
  await startPinch(page, midpoint);
  await spreadPinch(page, midpoint, 1);
  await expect(viewer(page)).toHaveAttribute('data-size', 'fit');
  expect((await image(page).boundingBox()).width).toBeCloseTo(fitWidth, 1);
  await expect(zoom(page)).toHaveText('Fit ▾');
  await endPinch(page, midpoint);
  await close(page).tap();
});

test('lifting a pinch finger or adding a third finger cannot turn the gesture into browsing or backdrop dismissal', async ({ page }) => {
  await setup(page);
  await open(page);
  const midpoint = await stageCenter(page);
  await startPinch(page, midpoint);
  await spreadPinch(page, midpoint, 180);
  const pinchedWidth = (await image(page).boundingBox()).width;
  await touch(page, 'pointerup', 2, midpoint);
  await touch(page, 'pointermove', 1, { x: midpoint.x - 180, y: midpoint.y });
  await touch(page, 'pointerup', 1, { x: midpoint.x - 180, y: midpoint.y });
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('1 / 3');
  expect((await image(page).boundingBox()).width).toBeCloseTo(pinchedWidth, 1);

  await zoom(page).tap();
  await viewer(page).getByRole('button', { name: 'Fit to window', exact: true }).tap();
  const fittedWidth = (await image(page).boundingBox()).width;
  await startPinch(page, midpoint);
  await touch(page, 'pointerdown', 3, { x: midpoint.x, y: midpoint.y + 20 });
  await spreadPinch(page, midpoint, 240);
  for (const id of [3, 2, 1]) await touch(page, 'pointerup', id, { x: midpoint.x - 160, y: midpoint.y });
  // Browsers can synthesize a trailing click; it must not close the viewer.
  await stage(page).dispatchEvent('click', { button: 0, clientX: midpoint.x, clientY: midpoint.y });
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('1 / 3');
  expect((await image(page).boundingBox()).width).toBeCloseTo(fittedWidth, 1);
  await close(page).tap();
});

test('one finger pans a zoomed image without advancing the gallery', async ({ page }) => {
  await setup(page);
  await open(page);
  await chooseActualSize(page);
  const midpoint = await stageCenter(page);
  const before = await stage(page).evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop }));
  await touch(page, 'pointerdown', 1, midpoint);
  await touch(page, 'pointermove', 1, { x: midpoint.x - 80, y: midpoint.y - 60 });
  await touch(page, 'pointerup', 1, { x: midpoint.x - 80, y: midpoint.y - 60 });
  const after = await stage(page).evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop }));
  expect(after.x - before.x).toBeCloseTo(80, 0);
  expect(after.y - before.y).toBeCloseTo(60, 0);
  await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('1 / 3');
  await expect(zoom(page)).toHaveText('100% ▾');
  await close(page).tap();
});

test('canceled touches and replaced images release transform state before the next gesture', async ({ page }) => {
  await setup(page);
  await open(page);
  const midpoint = await stageCenter(page);
  await startPinch(page, midpoint);
  await spreadPinch(page, midpoint, 160);
  const widthAtCancel = (await image(page).boundingBox()).width;
  await touch(page, 'pointercancel', 2, midpoint);
  await touch(page, 'pointermove', 1, { x: midpoint.x - 180, y: midpoint.y });
  await touch(page, 'pointerup', 1, midpoint);
  expect((await image(page).boundingBox()).width).toBeCloseTo(widthAtCancel, 1);
  await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('1 / 3');

  await startPinch(page, midpoint);
  await viewer(page).getByRole('button', { name: 'Next image', exact: true }).tap();
  await expect(image(page)).toHaveAttribute('src', imageURL('tall'));
  await expect(image(page)).toBeVisible();
  const nextWidth = (await image(page).boundingBox()).width;
  await spreadPinch(page, midpoint, 240);
  await endPinch(page, midpoint);
  await expect(viewer(page)).toHaveAttribute('data-size', 'fit');
  expect((await image(page).boundingBox()).width).toBeCloseTo(nextWidth, 1);
  await startPinch(page, midpoint);
  await spreadPinch(page, midpoint, 200);
  expect((await image(page).boundingBox()).width).toBeGreaterThan(nextWidth * 1.9);
  await endPinch(page, midpoint);
  await close(page).tap();
});

test('native browser touch input pinches only the image and keeps the close control on screen', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch dispatch requires Chromium CDP; Android Firefox is checked separately.');
  await setup(page);
  await open(page);
  const midpoint = await stageCenter(page);
  const initialWidth = (await image(page).boundingBox()).width;
  const initialPageScale = await page.evaluate(() => visualViewport.scale);
  const session = await page.context().newCDPSession(page);
  const points = (distance) => [
    { id: 1, x: midpoint.x - distance / 2, y: midpoint.y, radiusX: 1, radiusY: 1 },
    { id: 2, x: midpoint.x + distance / 2, y: midpoint.y, radiusX: 1, radiusY: 1 },
  ];
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) });
    for (let distance = 120; distance <= 220; distance += 20) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await image(page).boundingBox()).width).toBeGreaterThan(initialWidth * 1.8);
    expect(await page.evaluate(() => visualViewport.scale)).toBe(initialPageScale);
    await expectInsideViewport(page, close(page));
    await expect(viewer(page).locator('[data-peek-counter]')).toHaveText('1 / 3');
    await close(page).tap();
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {});
    await session.detach();
  }
});
