import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const contentScript = fileURLToPath(new URL('../extension/content.js', import.meta.url));
const stylesheet = fileURLToPath(new URL('../extension/viewer.css', import.meta.url));
const origin = 'https://github.com';
const prPath = '/acme/widget/pull/12';
const largeImage = `${origin}/user-attachments/assets/large.png`;
const smallImage = `${origin}/fixtures/thumb.svg`;

const svg = (width = 2400, height = 1600) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#9333ea"/><circle cx="50%" cy="50%" r="100" fill="white"/></svg>`;

const fixture = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pull request fixture</title>
<style>body { margin: 0; font: 16px system-ui; } main { padding: 24px; } .spacer { height: 1200px; } .markdown-body img, .image-diff img, [data-testid="image-diff"] img { width: 240px; height: 160px; } .after { height: 1800px; }</style>
</head><body><main><h1>Pull request fixture</h1><a href="/acme/widget">Repository</a>
<div class="spacer"></div>
<section class="markdown-body" aria-label="Pull request description">
  <a id="description-image" href="${largeImage}"><img src="${largeImage}" alt="Release screenshot"></a>
  <a id="slow-image" href="${origin}/user-attachments/assets/slow.png"><img src="${smallImage}" alt="Slow screenshot"></a>
  <a id="broken-image" href="${origin}/user-attachments/assets/broken.png"><img src="${smallImage}" alt="Unavailable screenshot"></a>
</section>
<section class="markdown-body" aria-label="Comment">
  <a id="comment-image" href="${largeImage}"><img src="${largeImage}" alt="Comment screenshot"></a>
  <img id="unlinked-image" src="${largeImage}" alt="Inline screenshot">
  <a id="ordinary-link" href="https://example.org/docs"><img src="${smallImage}" alt="Documentation"></a>
  <a id="blob-link" href="/acme/widget/blob/main/example.png"><img src="${smallImage}" alt="Source file"></a>
  <a id="download-link" href="${largeImage}" download><img src="${smallImage}" alt="Download"></a>
  <a id="avatar-link" href="/octocat"><img class="avatar" src="${smallImage}" alt="Octocat"></a>
  <button id="image-control" type="button"><img src="${smallImage}" alt="Image control"></button>
  <div contenteditable="true"><img id="editable-image" src="${smallImage}" alt="Editable screenshot"></div>
  <button id="ordinary-control" type="button">Resolve conversation</button>
</section>
<section class="image-diff" aria-label="Changed image"><img id="file-image" src="${largeImage}" alt="Changed screenshot"></section>
<div class="after"></div></main></body></html>`;

async function setup(page, { path = prPath, slowImage } = {}) {
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/broken.png')) {
      await route.abort('failed');
    } else if (url.pathname.endsWith('/slow.png')) {
      if (slowImage) await slowImage;
      await route.fulfill({ contentType: 'image/svg+xml', body: svg() });
    } else if (url.pathname.startsWith('/user-attachments/') || url.pathname === '/fixtures/thumb.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: svg() });
    } else {
      await route.fulfill({ contentType: 'text/html', body: fixture });
    }
  });
  await page.goto(`${origin}${path}`);
  await page.addStyleTag({ path: stylesheet });
  await page.addScriptTag({ path: contentScript });
}

const viewer = (page) => page.getByRole('dialog', { name: 'Image viewer', exact: true });
const closeButton = (page) => page.getByRole('button', { name: 'Close image viewer', exact: true });

// Keep intentionally ignored links in this fixture while recording whether the
// extension prevented their browser-default action. This listener runs after it.
async function observeIgnoredClicks(page) {
  await page.evaluate(() => {
    window.ignoredClicks = [];
    for (const type of ['click', 'auxclick', 'contextmenu']) {
      document.addEventListener(type, (event) => {
        window.ignoredClicks.push({ type, prevented: event.defaultPrevented, button: event.button });
        event.preventDefault();
      }, true);
    }
  });
}

test('opens description and comment images at full resolution and fits them to the viewport', async ({ page }) => {
  await setup(page);
  for (const selector of ['#description-image', '#comment-image', '#unlinked-image']) {
    await page.locator(selector).click();
    await expect(viewer(page)).toBeVisible();
    const image = viewer(page).locator('img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBe(2400);
    expect(await image.getAttribute('src')).toBe(largeImage);
    const bounds = await image.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole('link', { name: 'Open original image', exact: true })).toHaveAttribute('href', largeImage);
    await closeButton(page).click();
    await expect(viewer(page)).not.toBeVisible();
  }
});

test('actual size exposes original pixels with a keyboard-scrollable viewport', async ({ page }) => {
  await setup(page);
  await page.locator('#description-image').click();
  await page.getByRole('button', { name: 'Actual size', exact: true }).click();
  const stage = viewer(page).locator('[data-peek-stage]');
  await expect(viewer(page)).toHaveAttribute('data-size', 'actual');
  await expect(stage).toBeFocused();
  const dimensions = await viewer(page).locator('img').evaluate((image) => ({
    width: image.getBoundingClientRect().width,
    naturalWidth: image.naturalWidth,
  }));
  expect(dimensions.width).toBe(dimensions.naturalWidth);
  expect(await stage.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => stage.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await expect(viewer(page)).toHaveAttribute('data-size', 'fit');
});

test('a narrow viewport keeps toolbar controls and the fitted image usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('#description-image').click();
  await expect(viewer(page).locator('img')).toBeVisible();
  for (const control of await viewer(page).locator('[data-peek-toolbar] button, [data-peek-toolbar] a').all()) {
    const bounds = await control.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  }
  const stage = await viewer(page).locator('[data-peek-stage]').boundingBox();
  const image = await viewer(page).locator('img').boundingBox();
  expect(image.x).toBeGreaterThanOrEqual(stage.x);
  expect(image.y).toBeGreaterThanOrEqual(stage.y);
  expect(image.x + image.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(image.y + image.height).toBeLessThanOrEqual(stage.y + stage.height);
  await page.getByRole('button', { name: 'Actual size', exact: true }).click();
  await expect(viewer(page)).toHaveAttribute('data-size', 'actual');
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await expect(viewer(page)).toHaveAttribute('data-size', 'fit');
  await closeButton(page).click();
  await expect(viewer(page)).not.toBeVisible();
});

for (const method of ['Escape', 'close button', 'backdrop']) {
  test(`closing with ${method} restores opener focus and PR scroll`, async ({ page }) => {
    await setup(page);
    const opener = page.locator('#description-image');
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    expect(before.y).toBeGreaterThan(0);
    await opener.click();
    await expect(closeButton(page)).toBeFocused();
    if (method === 'Escape') {
      await page.keyboard.press('Escape');
    } else if (method === 'close button') {
      await closeButton(page).click();
    } else {
      await viewer(page).locator('[data-peek-stage]').click({ position: { x: 8, y: 8 } });
    }
    await expect(viewer(page)).not.toBeVisible();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
    // Cleanup must also work on the next open, without stale state/listeners.
    await opener.click();
    await expect(viewer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  });
}

test('keyboard focus stays inside the modal while background controls are inert', async ({ page }) => {
  await setup(page);
  await page.locator('#description-image').focus();
  await page.keyboard.press('Enter');
  await expect(closeButton(page)).toBeFocused();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press(index < 4 ? 'Tab' : 'Shift+Tab');
    expect(await viewer(page).evaluate((dialog) => dialog.contains(dialog.getRootNode().activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#description-image')).toBeFocused();
});

test('modal keyboard actions do not trigger existing GitHub document shortcuts', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.shortcutEvents = [];
    document.addEventListener('keydown', (event) => window.shortcutEvents.push(event.key), true);
  });
  await page.locator('#description-image').click();
  await page.keyboard.press('q');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.shortcutEvents)).toEqual([]);
  await page.keyboard.press('q');
  expect(await page.evaluate(() => window.shortcutEvents)).toEqual(['q']);
});

test('Ctrl, Cmd, Shift, Alt, middle and context clicks retain their default behavior', async ({ page }) => {
  await setup(page);
  await observeIgnoredClicks(page);
  const opener = page.locator('#description-image');
  for (const modifier of ['Control', 'Meta', 'Shift', 'Alt']) {
    await opener.click({ modifiers: [modifier] });
    await expect(viewer(page)).not.toBeVisible();
    expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
  }
  await opener.click({ button: 'middle' });
  await expect(viewer(page)).not.toBeVisible();
  expect(await page.evaluate(() => window.ignoredClicks.at(-1))).toMatchObject({ type: 'auxclick', button: 1, prevented: false });
  await opener.click({ button: 'right' });
  await expect(viewer(page)).not.toBeVisible();
  const rightClickEvents = await page.evaluate(() => window.ignoredClicks.filter((event) => event.button === 2));
  expect(rightClickEvents).toContainEqual({ type: 'contextmenu', button: 2, prevented: false });
  expect(rightClickEvents).toContainEqual({ type: 'auxclick', button: 2, prevented: false });
});

test('ignores unrelated destinations, downloads, avatars, editing areas and GitHub controls', async ({ page }) => {
  await setup(page);
  await observeIgnoredClicks(page);
  for (const selector of ['#ordinary-link', '#blob-link', '#download-link', '#avatar-link', '#image-control', '#editable-image', '#ordinary-control']) {
    await page.locator(selector).click();
    await expect(viewer(page)).not.toBeVisible();
    expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
  }
});

test('opens direct image text links and extensionless GitHub attachment previews', async ({ page }) => {
  await setup(page);
  await page.evaluate(({ largeImage, smallImage, origin }) => {
    const comment = document.createElement('section');
    comment.className = 'markdown-body';
    comment.innerHTML = `<a id="text-image" href="${largeImage}">Full screenshot</a>
      <a id="opaque-image" href="${origin}/user-attachments/assets/opaque-attachment"><img src="${smallImage}" width="240" height="160" alt="Opaque attachment"></a>`;
    document.querySelector('main').append(comment);
  }, { largeImage, smallImage, origin });
  await page.locator('#text-image').click();
  await expect(viewer(page).locator('img')).toHaveAttribute('alt', 'Pull request image');
  await expect(viewer(page).locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#opaque-image').click();
  await expect(viewer(page).locator('img')).toBeVisible();
  await expect(viewer(page).locator('img')).toHaveAttribute('src', `${origin}/user-attachments/assets/opaque-attachment`);
});

test('ignores non-HTTP image sources and link destinations', async ({ page }) => {
  await setup(page);
  await page.evaluate(({ smallImage, imageData }) => {
    const comment = document.createElement('section');
    comment.className = 'markdown-body';
    comment.innerHTML = `<a id="script-image" href="javascript:void(0)"><img src="${smallImage}" width="120" height="80" alt="Script destination"></a>
      <a id="data-link" href="${imageData}"><img src="${smallImage}" width="120" height="80" alt="Data destination"></a>
      <img id="data-image" src="${imageData}" width="120" height="80" alt="Data source">`;
    document.querySelector('main').append(comment);
  }, { smallImage, imageData: `data:image/svg+xml,${encodeURIComponent(svg(120, 80))}` });
  await observeIgnoredClicks(page);
  for (const selector of ['#script-image', '#data-link', '#data-image']) {
    await page.locator(selector).click();
    await expect(viewer(page)).not.toBeVisible();
    expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
  }
});

test('opens inline Files changed previews and comments added after initial load', async ({ page }) => {
  await setup(page, { path: `${prPath}/files` });
  await page.locator('#file-image').click();
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(({ largeImage }) => {
    const comment = document.createElement('section');
    comment.className = 'markdown-body';
    comment.innerHTML = `<a id="new-comment-image" href="${largeImage}"><img src="${largeImage}" width="240" height="160" alt="New screenshot"></a>`;
    document.querySelector('main').append(comment);
  }, { largeImage });
  await page.locator('#new-comment-image').click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator('img')).toHaveAttribute('alt', 'New screenshot');
});

test('handles SPA navigation into and out of a PR without reinjection', async ({ page }) => {
  await setup(page, { path: '/acme/widget/issues/4' });
  await observeIgnoredClicks(page);
  await page.locator('#description-image').click();
  await expect(viewer(page)).not.toBeVisible();
  expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
  await page.evaluate((path) => history.pushState({}, '', path), `${prPath}/files`);
  await page.locator('#description-image').click();
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => history.pushState({}, '', '/acme/widget/issues/5'));
  await page.locator('#description-image').click();
  await expect(viewer(page)).not.toBeVisible();
  expect(await page.evaluate(() => window.ignoredClicks.at(-1).prevented)).toBe(false);
});

test('cleans up an open viewer before GitHub replaces or caches the page', async ({ page }) => {
  await setup(page);
  for (const event of ['turbo:before-cache', 'turbo:before-render', 'pjax:beforeReplace']) {
    await page.locator('#description-image').click();
    await expect(viewer(page)).toBeVisible();
    await page.evaluate((type) => document.dispatchEvent(new Event(type)), event);
    await expect(viewer(page)).not.toBeVisible();
    // Navigation cleanup must release scroll locking as well as the dialog.
    await page.evaluate(() => window.scrollTo(0, 40));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(40);
  }
});

test('removing the modal releases its scroll lock and preserves prior inline styles', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    // A shorthand snapshot is empty when the two axes have different priorities.
    document.documentElement.style.setProperty('overflow-x', 'hidden', 'important');
    document.documentElement.style.setProperty('overflow-y', 'auto');
  });
  await page.locator('#description-image').click();
  await expect(viewer(page)).toBeVisible();
  await page.evaluate(() => document.querySelector('[data-gh-image-peek]').remove());
  await expect.poll(() => page.evaluate(() => ({
    x: document.documentElement.style.getPropertyValue('overflow-x'),
    xPriority: document.documentElement.style.getPropertyPriority('overflow-x'),
    y: document.documentElement.style.getPropertyValue('overflow-y'),
    yPriority: document.documentElement.style.getPropertyPriority('overflow-y'),
  }))).toEqual({ x: 'hidden', xPriority: 'important', y: 'auto', yPriority: '' });
  await page.evaluate(() => window.scrollTo(0, 40));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(40);
  await page.locator('#description-image').click();
  await expect(viewer(page)).toBeVisible();
});

test('navigation cleanup does not overwrite the next page scroll position', async ({ page }) => {
  await setup(page);
  await page.locator('#description-image').click();
  await expect(viewer(page)).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/acme/widget/pull/13');
    document.querySelector('main').innerHTML = '<h1>Next pull request</h1><div style="height:5000px"></div>';
    window.scrollTo(0, 200);
  });
  await expect(viewer(page)).not.toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(200);
  await expect(page.getByRole('heading', { name: 'Next pull request' })).toBeVisible();
});

test('announces loading and transitions to a successfully loaded image', async ({ page }) => {
  let release;
  const slowImage = new Promise((resolve) => { release = resolve; });
  await setup(page, { slowImage });
  await page.locator('#slow-image').click();
  await expect(viewer(page).getByText('Loading image…', { exact: true })).toBeVisible();
  release();
  await expect(viewer(page).locator('img')).toBeVisible();
  await expect(viewer(page).getByText('Loading image…', { exact: true })).not.toBeVisible();
});

test('a stalled image times out and a late load does not replace the failure state', async ({ page }) => {
  let release;
  const slowImage = new Promise((resolve) => { release = resolve; });
  await setup(page, { slowImage });
  await page.clock.install();
  await page.locator('#slow-image').click();
  await expect(viewer(page).getByText('Loading image…', { exact: true })).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(viewer(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
  const response = page.waitForResponse((item) => item.url().endsWith('/slow.png'));
  release();
  await response;
  await expect(viewer(page).locator('img')).not.toBeVisible();
  await expect(viewer(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
});

test('failed loads keep an accessible exit and a link to the original image', async ({ page }) => {
  await setup(page);
  await page.locator('#broken-image').click();
  await expect(viewer(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open original image', exact: true })).toHaveAttribute('href', `${origin}/user-attachments/assets/broken.png`);
  await expect(closeButton(page)).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(viewer(page)).not.toBeVisible();
  await page.locator('#description-image').click();
  await expect(viewer(page).locator('img')).toBeVisible();
  await expect(viewer(page).getByText('This image could not be loaded.', { exact: true })).not.toBeVisible();
});
