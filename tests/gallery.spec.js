import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../extension/content.js', import.meta.url));
const stylesheet = fileURLToPath(new URL('../extension/viewer.css', import.meta.url));
const origin = 'https://github.com';
const imageURL = (name) => `${origin}/user-attachments/assets/${name}.png`;
const thumbnail = `${origin}/gallery/thumbnail.svg`;
const preview = (id, name, alt = name) => `<a id="${id}" href="${imageURL(name)}"><img src="${thumbnail}" alt="${alt}"></a>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="#9333ea"/></svg>';
const standardBody = `
  <section class="markdown-body" aria-label="Description">${preview('first', 'a', 'Description screenshot')}</section>
  <section class="markdown-body" aria-label="Comment">
    ${preview('second', 'b', 'Comment screenshot')}
    <a id="duplicate" href="${imageURL('a')}#duplicate"><img src="${thumbnail}" alt="Duplicate screenshot"></a>
    <span hidden>${preview('hidden', 'hidden')}</span>
    <span style="display:none">${preview('not-displayed', 'not-displayed')}</span>
    <span style="visibility:hidden">${preview('not-visible', 'not-visible')}</span>
    <details><summary>Collapsed content</summary>${preview('collapsed', 'collapsed')}</details>
    <a href="${imageURL('avatar')}"><img class="avatar" src="${thumbnail}" alt="Avatar"></a>
    <button type="button">${preview('button-image', 'button-image')}</button>
    <div contenteditable="true">${preview('editing-image', 'editing-image')}</div>
    <a href="https://example.org/documentation"><img src="${thumbnail}" alt="Documentation badge"></a>
    <a href="${imageURL('download')}" download><img src="${thumbnail}" alt="Download"></a>
  </section>
  <section class="image-diff"><img id="third" src="${imageURL('c')}" alt="File screenshot"></section>
  <section class="markdown-body"><a id="fourth" href="${imageURL('d')}">Full screenshot</a></section>`;

async function setup(page, { body = standardBody, slowImage } = {}) {
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/broken.png')) {
      await route.abort('failed');
    } else if (path.endsWith('/slow.png')) {
      if (slowImage) await slowImage;
      await route.fulfill({ contentType: 'image/svg+xml', body: svg });
    } else if (path.startsWith('/user-attachments/') || path === '/gallery/thumbnail.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: svg });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gallery fixture</title>
        <style>body{margin:0;font:16px system-ui}main{padding:24px}.spacer{height:900px}.markdown-body img,.image-diff img{width:160px;height:100px}.markdown-body a{display:inline-block;margin:8px}.after{height:2000px}</style>
        </head><body><main><h1>Pull request gallery</h1><div class="spacer"></div>${body}<div class="after"></div></main></body></html>` });
    }
  });
  await page.goto(`${origin}/acme/widget/pull/12/files`);
  await page.addStyleTag({ path: stylesheet });
  await page.addScriptTag({ path: script });
}

const dialog = (page) => page.getByRole('dialog', { name: 'Image viewer', exact: true });
const counter = (page) => dialog(page).locator('[data-peek-counter]');
const image = (page) => dialog(page).locator('[data-peek-image]');
const previous = (page) => dialog(page).getByRole('button', { name: 'Previous image', exact: true });
const next = (page) => dialog(page).getByRole('button', { name: 'Next image', exact: true });
const stage = (page) => dialog(page).locator('[data-peek-stage]');
const original = (page) => dialog(page).getByRole('link', { name: 'Open original image', exact: true });

async function expectCurrent(page, name, position) {
  await expect(counter(page)).toHaveText(`${position} of 4`);
  await expect(image(page)).toHaveAttribute('src', imageURL(name));
  await expect(original(page)).toHaveAttribute('href', imageURL(name));
  await expect(image(page)).toBeVisible();
}

async function pointer(page, type, values = {}) {
  await stage(page).dispatchEvent(type, {
    pointerType: 'touch', pointerId: 1, isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: 500, clientY: 300, ...values,
  });
}

test('browses eligible images in document order, deduplicates originals, and stops at both ends', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  await expectCurrent(page, 'b', 2);
  await expect(image(page)).toHaveAttribute('alt', 'Comment screenshot');
  await previous(page).click();
  await expectCurrent(page, 'a', 1);
  await expect(previous(page)).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expectCurrent(page, 'a', 1);
  await page.keyboard.press('ArrowRight');
  await expectCurrent(page, 'b', 2);
  await next(page).click();
  await expectCurrent(page, 'c', 3);
  await expect(image(page)).toHaveAttribute('alt', 'File screenshot');
  await next(page).click();
  await expectCurrent(page, 'd', 4);
  await expect(next(page)).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expectCurrent(page, 'd', 4);
});

test('opening a duplicate keeps the clicked description and restores that original opener after browsing', async ({ page }) => {
  await setup(page);
  const opener = page.locator('#duplicate');
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await opener.click();
  await expect(counter(page)).toHaveText('1 of 4');
  await expect(image(page)).toHaveAttribute('alt', 'Duplicate screenshot');
  await next(page).click();
  await expectCurrent(page, 'b', 2);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
});

test('single unique images keep the original viewer without navigation or a counter', async ({ page }) => {
  await setup(page, { body: `<section class="markdown-body">${preview('single', 'a')}<a href="${imageURL('a')}#same">Same original</a></section>` });
  await page.locator('#single').click();
  await expect(image(page)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Previous image', exact: true, includeHidden: true })).not.toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Next image', exact: true, includeHidden: true })).not.toBeVisible();
  await expect(counter(page)).not.toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(image(page)).toHaveAttribute('src', imageURL('a'));
});

test('modified arrow keys do not navigate the gallery', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    await stage(page).dispatchEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', [modifier]: true });
    await expectCurrent(page, 'b', 2);
  }
});

test('Actual size keeps arrow-key panning while screen arrows reset the next image to Fit', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  await dialog(page).getByRole('button', { name: 'Actual size', exact: true }).click();
  await expect(stage(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => stage(page).evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await expectCurrent(page, 'b', 2);
  await next(page).click();
  await expectCurrent(page, 'c', 3);
  await expect(dialog(page)).toHaveAttribute('data-size', 'fit');
  await expect(dialog(page).getByRole('button', { name: 'Actual size', exact: true })).toBeEnabled();
  expect(await stage(page).evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual({ x: 0, y: 0 });
});

test('gallery controls participate in keyboard focus containment and boundary changes retain focus', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  await expect(image(page)).toBeVisible();
  const focusedLabels = [];
  for (let step = 0; step < 16; step += 1) {
    await page.keyboard.press(step < 8 ? 'Tab' : 'Shift+Tab');
    const state = await dialog(page).evaluate((node) => ({
      inside: node.contains(document.activeElement),
      label: document.activeElement.getAttribute('aria-label'),
      disabled: document.activeElement.disabled === true,
    }));
    expect(state.inside).toBe(true);
    expect(state.disabled).toBe(false);
    focusedLabels.push(state.label);
  }
  expect(focusedLabels).toContain('Previous image');
  expect(focusedLabels).toContain('Next image');
  await next(page).click();
  await next(page).click();
  await expect(next(page)).toBeDisabled();
  expect(await dialog(page).evaluate((node) => node.contains(document.activeElement) && document.activeElement.disabled !== true)).toBe(true);
});

test('reopening refreshes the gallery for newly loaded comments without changing an active snapshot', async ({ page }) => {
  await setup(page);
  await page.locator('#first').click();
  await expect(counter(page)).toHaveText('1 of 4');
  await page.evaluate(({ html }) => {
    const section = document.createElement('section');
    section.className = 'markdown-body';
    section.innerHTML = html;
    document.querySelector('main').append(section);
  }, { html: preview('new-comment', 'new', 'New comment screenshot') });
  await expect(counter(page)).toHaveText('1 of 4');
  await page.keyboard.press('Escape');
  await page.locator('#new-comment').click();
  await expect(counter(page)).toHaveText('5 of 5');
  await expect(image(page)).toHaveAttribute('alt', 'New comment screenshot');
  await expect(next(page)).toBeDisabled();
});

test('failed images can be skipped and each image has its own original link', async ({ page }) => {
  await setup(page, { body: `<section class="markdown-body">${preview('first', 'a')}${preview('broken', 'broken')}${preview('last', 'c')}</section>` });
  await page.locator('#first').click();
  await next(page).click();
  await expect(counter(page)).toHaveText('2 of 3');
  await expect(dialog(page).getByText('This image could not be loaded.', { exact: true })).toBeVisible();
  await expect(original(page)).toHaveAttribute('href', imageURL('broken'));
  await expect(next(page)).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  await expect(counter(page)).toHaveText('3 of 3');
  await expect(image(page)).toBeVisible();
  await expect(image(page)).toHaveAttribute('src', imageURL('c'));
  await expect(original(page)).toHaveAttribute('href', imageURL('c'));
  await expect(dialog(page).getByText('This image could not be loaded.', { exact: true })).not.toBeVisible();
});

test('switching away from a slow image ignores its stale callbacks and its old timeout', async ({ page }) => {
  let release;
  const slowImage = new Promise((resolve) => { release = resolve; });
  await setup(page, { slowImage, body: `<section class="markdown-body">${preview('slow', 'slow')}${preview('last', 'b')}</section>` });
  await page.clock.install();
  try {
    await page.locator('#slow').click();
    await expect(dialog(page).getByText('Loading image…', { exact: true })).toBeVisible();
    const obsoleteImage = await image(page).elementHandle();
    await page.clock.fastForward(20_000);
    await next(page).click();
    await expect(counter(page)).toHaveText('2 of 2');
    await expect(image(page)).toBeVisible();
    await expect(image(page)).toHaveAttribute('src', imageURL('b'));
    release();
    // Firefox may abort the superseded network request once its element is
    // removed. Explicit late events also exercise the stale callback boundary.
    await obsoleteImage.evaluate((node) => {
      node.dispatchEvent(new Event('load'));
      node.dispatchEvent(new Event('error'));
    });
    await page.clock.fastForward(10_001);
    await expect(image(page)).toBeVisible();
    await expect(image(page)).toHaveAttribute('src', imageURL('b'));
    await expect(dialog(page).getByText('This image could not be loaded.', { exact: true })).not.toBeVisible();
  } finally {
    release();
  }
});

test('a previous image timeout cannot interrupt the next image while it is loading', async ({ page }) => {
  let release;
  const slowImage = new Promise((resolve) => { release = resolve; });
  await setup(page, { slowImage, body: `<section class="markdown-body">${preview('first', 'a')}${preview('slow', 'slow')}</section>` });
  await page.clock.install();
  try {
    await page.locator('#first').click();
    await expect(image(page)).toBeVisible();
    await page.clock.fastForward(20_000);
    await next(page).click();
    await expect(dialog(page).getByText('Loading image…', { exact: true })).toBeVisible();
    await page.clock.fastForward(10_001);
    await expect(dialog(page).getByText('Loading image…', { exact: true })).toBeVisible();
    release();
    await expect(image(page)).toBeVisible();
    await expect(image(page)).toHaveAttribute('src', imageURL('slow'));
  } finally {
    release();
  }
});

test('horizontal touch and pen swipes navigate without backdrop dismissal', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  await pointer(page, 'pointerdown', { clientX: 500 });
  await pointer(page, 'pointermove', { clientX: 300 });
  await pointer(page, 'pointerup', { clientX: 300 });
  await stage(page).dispatchEvent('click');
  await expect(dialog(page)).toBeVisible();
  await expectCurrent(page, 'c', 3);
  await pointer(page, 'pointerdown', { pointerType: 'pen', clientX: 300 });
  await pointer(page, 'pointermove', { pointerType: 'pen', clientX: 500 });
  await pointer(page, 'pointerup', { pointerType: 'pen', clientX: 500 });
  await expectCurrent(page, 'b', 2);
});

test('vertical, short, canceled, mouse, and multitouch gestures do not switch images', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  await pointer(page, 'pointerdown');
  await pointer(page, 'pointermove', { clientX: 490, clientY: 450 });
  await pointer(page, 'pointerup', { clientX: 490, clientY: 450 });
  await pointer(page, 'pointerdown');
  await pointer(page, 'pointerup', { clientX: 480 });
  await pointer(page, 'pointerdown');
  await pointer(page, 'pointercancel');
  await pointer(page, 'pointerup', { clientX: 200 });
  await pointer(page, 'pointerdown', { pointerType: 'mouse' });
  await pointer(page, 'pointerup', { pointerType: 'mouse', clientX: 200 });
  await pointer(page, 'pointerdown');
  await pointer(page, 'pointerdown', { pointerId: 2, isPrimary: false, clientX: 600 });
  await pointer(page, 'pointerup', { pointerId: 2, isPrimary: false, clientX: 300 });
  await pointer(page, 'pointerup', { clientX: 200 });
  await expectCurrent(page, 'b', 2);
});

test('touch gestures in Actual size leave image navigation to the screen arrows', async ({ page }) => {
  await setup(page);
  await page.locator('#second').click();
  await dialog(page).getByRole('button', { name: 'Actual size', exact: true }).click();
  await pointer(page, 'pointerdown');
  await pointer(page, 'pointermove', { clientX: 200 });
  await pointer(page, 'pointerup', { clientX: 200 });
  await expectCurrent(page, 'b', 2);
  await expect(dialog(page)).toHaveAttribute('data-size', 'actual');
});

for (const width of [320, 390]) {
  test(`gallery controls stay in view and images fit at ${width}px, including Actual size`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await setup(page);
    await page.locator('#second').click();
    await expect(image(page)).toBeVisible();
    const viewport = await stage(page).boundingBox();
    const fitted = await image(page).boundingBox();
    expect(fitted.x).toBeGreaterThanOrEqual(viewport.x);
    expect(fitted.y).toBeGreaterThanOrEqual(viewport.y);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
    for (const actual of [false, true]) {
      if (actual) await dialog(page).getByRole('button', { name: 'Actual size', exact: true }).click();
      for (const control of [previous(page), next(page), counter(page)]) {
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
      }
    }
    await next(page).click();
    await expectCurrent(page, 'c', 3);
    await expect(dialog(page)).toHaveAttribute('data-size', 'fit');
  });
}
