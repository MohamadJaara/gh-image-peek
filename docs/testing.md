# Testing

## Automated

```sh
npm ci
npx playwright install firefox chromium
npm test
```

`npm test` runs `test:unit` (build and release script tests) followed by `test:browser` (Playwright). Either can be run separately.

The Playwright suite runs in Firefox and Chromium against local GitHub fixtures; it never hits github.com. It injects `content.js` and `viewer.css` into fixture pages and covers:

- **Opening and closing:** full-resolution loading, fit and actual size, all close methods, focus and scroll restoration, modifier and middle clicks, excluded links, newly loaded comments, SPA navigation, and loading/error/timeout states.
- **Gallery:** ordering and deduplication, boundaries, arrow keys vs. panning, touch and pen swipes, failed or superseded loads.
- **Zoom:** presets and bounds, focus-scoped shortcuts, Ctrl-wheel targeting and anchoring, plain-wheel scrolling, double-click, drag panning, and resizing.
- **Layout:** header counter, tall images, help panel, and narrow or short windows.

The `firefox-touch` and `chromium-touch` projects use real tap input and touch viewports:

```sh
npm run test:browser -- --project=firefox-touch --project=chromium-touch
```

`tests/extension.spec.js` loads the built Chrome extension into a persistent Chromium profile, which checks that manifest-declared injection works. Firefox touch tests run in desktop Firefox, not Firefox for Android.

Nothing automated covers live GitHub markup, signed installation, or update flows.

## Manual checks on desktop

Run these on a real PR in each browser after installing the built extension.

1. Open a large image from the description, a comment, and an inline Files changed preview. Try Fit, 100%, the larger presets, arrow-key panning, and all three ways of closing.
2. Start partway down the PR, then open and close the viewer a few times. Scroll position and focus should stay on the image you opened.
3. Ctrl/Cmd-click, Shift-click, and middle-click an image. Click a normal text link, a badge that links to a website, and GitHub's review controls. None of these should open the viewer.
4. Navigate into the PR from another GitHub page without reloading. Load more comments or switch to Files changed, then open a newly rendered image.
5. Block an image request in devtools. The viewer should show an error with **Open original image**, and Escape and `×` should still close it.
6. On a PR with several images, browse with the buttons, the arrow keys, and a touch swipe. Check the counter and both ends of the list, and skip past a failed image. At 100%, the arrow keys should pan instead of switching images. Browse away from the first image, close, and check that focus returns to the image you originally opened. On a single-image PR the arrows and counter should be hidden.
7. Ctrl-scroll over the image (zooms the image) and over the toolbar or backdrop (zooms the page). Then try plain scrolling, double-click, drag, `+ − 0 1`, and the browser's own Ctrl/Cmd zoom.
8. Open a tall image that has a long caption. Open help with the mouse and with the keyboard, and scroll it in a short window. Only one of help and the zoom presets should be open at a time.

## Manual checks on Firefox for Android

1. Open an image from partway down a PR. Close it with `×` and with the backdrop, and confirm the page position is restored. Check labels and focus with TalkBack.
2. Browse using the arrows and swipes. Check both ends, the counter, and a newly loaded comment after reopening.
3. Pinch-zoom on the image up to 400% and pan with one finger. Panning or a cancelled pinch shouldn't switch images or close the viewer, and the controls should stay reachable.
4. Rotate between portrait and landscape and collapse the toolbar, both at Fit and zoomed in. Open help and presets in the smallest viewport and scroll to the end of each.
5. Browse past a failed image. Try system Back with the viewer open and with a panel open.

The last emulator run is recorded in [verification/firefox-android-0.6.0.md](verification/firefox-android-0.6.0.md).
