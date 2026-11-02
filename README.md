<img src="extension/icons/icon.svg" width="64" height="64" alt="">

# GH Image Peek

Click an image in a GitHub pull request to inspect it in a full-size viewer over the current page, then browse the PR’s other images. Keep your place in the review.

A small WebExtension for desktop Firefox, desktop Chrome, and Firefox for Android, built with plain JavaScript and CSS, with no runtime dependencies. One shared viewer produces separate browser packages.

## Install a signed Firefox release

Published [GitHub Releases](https://github.com/MohamadJaara/gh-image-peek/releases) include a Mozilla-signed `gh-image-peek-firefox-X.Y.Z.xpi`. Download that file, open `about:addons`, choose **Install Add-on From File…** from the settings menu, and accept Firefox's installation prompt. This installation survives restarts. Refresh GitHub tabs that were already open.

Signed releases include a GitHub update feed; Firefox checks it for newer signed versions when automatic updates are enabled. The first signed release and its feed must be published before this installation/update path is available. The unsigned development ZIPs below use temporary installation.

Maintainers: see [signing and releases](docs/releasing.md) for one-time credentials, version tags, release assets, and signing-review recovery.

## Install temporarily in Firefox

Requires **Firefox 140 or newer on desktop**.

This development build is **unsigned**. Opening the ZIP directly or using **Install Add-on From File…** in the regular add-ons manager produces “This add-on could not be installed because it has not been verified.” Load it through `about:debugging` instead:

1. Download the packaged **Firefox ZIP** (`gh-image-peek-firefox-X.Y.Z.zip`), or [build from source](#build-from-source).
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…**.
4. Select the **packaged Firefox ZIP**, or the generated `dist/firefox/manifest.json`. A GitHub source-code ZIP must be extracted and built first; it is not the packaged extension.
5. Open a GitHub pull request. Refresh GitHub tabs that were already open when you installed the extension.

The temporary add-on lasts until Firefox restarts. When loading from source, run `npm run build` after code changes, click **Reload** next to GH Image Peek in `about:debugging`, then refresh the GitHub tab. To update a ZIP installation, remove the old temporary add-on and load the new ZIP, then refresh GitHub.

See Mozilla’s [temporary installation instructions](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

For installation that survives Firefox restarts, the extension must first be [signed by Mozilla](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). An unlisted, signed build can be distributed directly without a public add-ons listing.

## Install in Firefox for Android

The Firefox package also targets **Firefox 142 or newer on Android**. Firefox for iOS cannot run this extension; Mozilla's [Firefox for iOS documentation](https://support.mozilla.org/en-US/kb/add-ons-firefox-ios) explains that platform limit.

The current build is unsigned. For development, temporarily load the generated Firefox directory from a computer:

1. [Build from source](#build-from-source), install Android Platform Tools, and put `adb` on your computer's `PATH`. Use Node.js 22+ for the current [Mozilla `web-ext` commands](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
2. On your Android device or emulator, install Firefox, enable Android USB debugging, and enable **Remote debugging via USB** in Firefox settings. Connect the device and authorize the computer when prompted.
3. Finish Firefox's first-run setup, open a tab, and run the following on the computer. Replace `DEVICE_SERIAL` with the value shown by `adb devices`:

   ```sh
   npm run build
   adb devices
   npx web-ext run --source-dir dist/firefox --target=firefox-android \
     --adb-device=DEVICE_SERIAL --firefox-apk=org.mozilla.firefox
   ```

4. Follow any prompts, then open or refresh a GitHub PR. Rebuild and run the command again after changing the source.

For Nightly, use `--firefox-apk=org.mozilla.fenix`; for Beta, use `org.mozilla.firefox_beta`. The flag names an installed browser package, rather than an APK file. This is Mozilla's [temporary Android extension workflow](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#install-and-run-your-extension-in-firefox-for-android).

Persistent installation requires a **Mozilla-signed XPI**. No signed Android release is provided by this development build. Once a signed XPI is available, save it on the device, open **Settings → About Firefox**, tap the Firefox logo five times quickly, return to **Settings → Install Extension from File**, and select it. See Mozilla's [signed-file installation instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-add-on-from-file-on-android). Revealing that menu does not make the unsigned ZIP installable.

## Install in desktop Chrome

Use **Load unpacked** for this development build:

1. Download and extract the packaged **Chrome ZIP** (`gh-image-peek-chrome-X.Y.Z.zip`), or [build from source](#build-from-source).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted Chrome package directory containing `manifest.json`, or the generated `dist/chrome/` directory. Select the directory, rather than the ZIP or manifest file.
5. Open a GitHub pull request. Refresh GitHub tabs that were already open when you installed the extension.

Keep the extracted directory available. For source changes, run `npm run build`, click **Reload** on the extension in `chrome://extensions`, then refresh the GitHub tab. Updates to an unpacked installation are manual. See Chrome’s [Load unpacked instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load_an_unpacked_extension).

Normal consumer distribution on Windows and macOS generally requires the **Chrome Web Store**; a GitHub ZIP is for the manual unpacked workflow above. Enterprise policies and Linux have additional distribution options. See Chrome’s [distribution rules](https://developer.chrome.com/docs/extensions/how-to/distribute). The Firefox XPI and Firefox update feed do not install or update the Chrome package.

Neither browser package adds a toolbar action or settings page. The viewer opens from images on the PR itself.

## Use

- Click or tap a screenshot or direct image link in a PR description, comment, or inline **Files changed** image preview. Linked images also open with **Enter** when focused.
- Images initially **fit to the window** without stretching small images. The image fills the area below the toolbar, with 12 px padding on desktop and 8 px on narrow windows. On narrow screens and short touch-screen landscape windows, gallery arrows sit over the image edges so the image can use the full width. Controls account for display safe areas. Transparent images have a checkerboard background.
- When the page has more than one unique image, use the **← / → screen buttons** or **Left / Right arrow keys** to browse in page order. A counter beside the caption in the header shows your position, such as **2 / 4**. Navigation stops at the first and last image; single-image pages hide these controls.
- Select **?** in the header for touch gestures, **Keyboard shortcuts**, and the gallery’s scope. Help opens over the viewer and keeps the image area the same size. Help and zoom presets scroll in short windows. Tab into help to scroll with a keyboard; **Escape** dismisses it and returns focus to the help button.
- On a touchscreen or with a pen, **swipe horizontally** across a fitted image to browse. Mouse drags, vertical gestures, and multitouch gestures do not change images.
- Use the compact **− / Fit / +** toolbar control to zoom. The center button shows the current percentage and opens presets: **Fit to window**, **100% · actual size**, **200%**, and **400%**. Zoom out stops at Fit; small images are not enlarged in Fit.
- **Ctrl + mouse wheel directly over the loaded image** zooms around the pointer. This deliberately replaces browser page zoom in that area while the viewer is open. Over the backdrop, toolbar, or page, the browser keeps its normal behavior. Plain wheel/two-finger scrolling continues to pan.
- **Double-click** an image to toggle Fit and 100%, zooming toward the clicked point. At a custom zoom or actual size, **drag with the primary mouse button**, scroll, or use touch panning to inspect details.
- On Android, **pinch directly on the loaded image** to zoom it from Fit up to 400%, then drag the zoomed image with one finger to pan. The **− / + buttons and zoom presets** are also available. Return to **Fit** before swiping between images. Pinching on the toolbar, empty image area, or backdrop retains the browser's page zoom.
- Click the image or Tab to its scrollable area to focus it. While that area has focus, **+** (or **=**) zooms in, **−** zooms out, **0** selects Fit, and **1** selects 100%. Ctrl/Cmd keyboard zoom shortcuts keep their browser behavior. Press **Escape** once to dismiss an open help or preset panel; otherwise it closes the viewer.
- In actual size or custom zoom, arrow keys pan while the image area is focused. The screen buttons still browse; each newly selected image starts fitted to the window. Returning to Fit restores keyboard and touch-swipe gallery navigation.
- Close with **Escape**, the **×** button, or a click on the empty backdrop. Even after browsing other images, closing restores focus to the image or link you originally clicked and keeps the PR’s scroll position.
- **Tab / Shift+Tab** move between the viewer’s controls and scrollable image area. The page behind the modal is inert.
- **Open original image** opens the source in a new tab when you explicitly choose it. This remains available if the image fails to load or takes longer than 30 seconds.

Ctrl/Cmd-click, Shift-click, Alt-click, middle-click, downloads, and the context menu retain their normal browser behavior. Images linking to documentation, profiles, or other nonimage destinations keep their normal link action. GitHub’s navigation buttons, editing areas, avatars, and other controls are left alone.

The gallery includes recognized images and direct image links currently rendered on the PR page, including images below the fold. Repeated original URLs appear once, and hidden or collapsed content is excluded. The image order stays fixed while the viewer is open; close and reopen it to include newly loaded comments. It does not fetch other PR tabs or load additional comments automatically.

Newly loaded comments and GitHub’s dynamic page navigation work without a refresh after the content script is initially loaded. An open viewer is dismissed when GitHub replaces or caches the page. You can browse past an image that is loading or has failed to load.

## Permissions and privacy

Both manifests declare a content script for **`https://github.com/*`**. The browser may describe this as permission to read or change data on github.com. It runs across GitHub so that navigating from a repository or issue into a PR works; clicks are intercepted only on numeric PR routes and within recognized image content.

There are **no extra API permissions**, background process, storage, analytics, backend, or third-party services. The extension does not upload, persist, or analyze images or page contents. It displays the original URL using an ordinary browser `<img>` element. The browser contacts that image’s existing host to load it, with normal browser authentication, content security, and tracking protections. It does not fetch images through a proxy or request access to their hosts.

The Firefox manifest explicitly declares no data collection through Firefox’s [built-in data consent mechanism](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Known limitations

- Only **github.com pull requests** are supported, including review comments in Files changed. GitHub Enterprise domains, issues, repository image pages, and other sites are outside this release.
- **Inline Files changed images are supported.** Some GitHub rich image comparisons live inside cross-origin `render.githubusercontent.com` frames. Clicks inside those frames cannot be intercepted with github.com-only access; GitHub’s own comparison controls continue to work.
- Detection is intentionally conservative. Direct image links with familiar file extensions and recognized linked previews work; an extensionless text link without a preview is left alone. Links to GitHub’s `blob` and `tree` pages retain normal navigation (a `blob` link explicitly using `?raw=true` or `?raw=1` can be viewed).
- **100%** means the browser’s intrinsic image dimensions in CSS pixels, not physical display pixels. Higher zoom magnifies those pixels without adding detail. The extension uses the linked original or the preview’s current source; it cannot recover a higher-resolution original when GitHub supplies only a thumbnail.
- Some trackpad pinch gestures produce Ctrl-wheel events and may use image zoom when the pointer is over the image. Touchscreen pinch on the loaded image controls image zoom; outside the image, native browser page zoom can move the viewer controls offscreen. Physical trackpad/touchscreen behavior has not been verified; automated checks include mouse input, real tap input in touch-enabled browser contexts, and synthesized gesture events.
- Expired private-image URLs, restrictive image-host policies, unsupported formats, or content security policies can prevent loading. Use **Open original image** to try the URL directly. SVGs are displayed as images, never inserted into the page as markup.
- GitHub’s markup can change. Unsupported previews keep their existing behavior. Image editing, image downloading, and preferences are outside this release.
- This release targets **desktop Firefox and Chrome, plus Firefox for Android**. The Android manifest minimum remains 142; that minimum version has not been tested on a device. Firefox for iOS and mobile Chrome are outside this release.
- Use **×** to close on Android. System Back handling depends on Firefox's native dialog support and is not guaranteed across the declared Android version range; see the [Android compatibility research](docs/research/firefox-android.md#android-back-and-native-dialog-cancellation).
- Automated checks use local GitHub fixtures in Firefox and Chromium, including actual extension loading in Chromium. The Firefox touch project uses desktop Firefox with touch input, not Firefox for Android. A local fixture in **Firefox 159 on an Android 16 Pixel 9a emulator** exercised native taps, horizontal gallery swipes, image-local pinch zoom, return to Fit, touch panning, failed-image recovery, closing, and focus restoration. The test environment did not authorize enabling USB remote debugging, so Android add-on installation and static injection remain unverified. Live GitHub markup, TalkBack, physical hardware, and production installation/update flows also need device checks. See the [mobile verification record](docs/verification/firefox-android-0.6.0.md).

## Build from source

Use Node.js 24+ to build and test the source; Node.js 22.x starting at 22.13 is also supported. CI and `.nvmrc` use Node.js 24. Node.js is not needed to install or use a packaged extension.

```sh
npm ci
npm run build
```

The build writes ready-to-load directories and unsigned ZIPs:

| Browser | Directory | Package |
| --- | --- | --- |
| Firefox | `dist/firefox/` | `dist/gh-image-peek-firefox-X.Y.Z.zip` |
| Chrome | `dist/chrome/` | `dist/gh-image-peek-chrome-X.Y.Z.zip` |

`X.Y.Z` comes from `package.json`. Shared metadata lives in `manifests/base.json`; Firefox and Chrome settings live in their matching override files. The build combines these with the shared JavaScript, stylesheet, and browser-compatible icons. Generated files in `dist/` are ignored by Git; edit the source and rebuild.

Chrome's PNG icons are checked in, so building packages does not require a browser. After changing `extension/icons/icon.svg`, install Playwright Chromium and run `npm run icons` to regenerate the PNG sizes. The ZIP helper is a development dependency and is never included in either extension.

## Verify changes

```sh
npm ci
npx playwright install firefox chromium
npm run build
npm run lint
npm run lint:extension
npm test
```

`npm run lint` checks maintained JavaScript and MJS files with ESLint's recommended correctness rules, including browser globals for the extension and Node globals for tooling. `npm run lint:fix` applies available fixes. Mozilla's separate `lint:extension` validates the generated Firefox manifest and package.

`npm test` builds both packages, checks their generated files, and runs Playwright. Use `npm run test:unit` for build verification or `npm run test:browser` for browser tests alone. See [repository maintenance](docs/maintenance.md) for workflow audits, dependency updates, and GitHub settings.

The shared Playwright suite runs in **Firefox and Chromium** and routes GitHub/image requests to local fixtures. It verifies full-resolution opening, viewport fitting and actual-size scrolling, dismissal, focus and scroll restoration, keyboard containment, modified and auxiliary clicks, safe exclusions, new comments, SPA navigation, navigation cleanup, and loading/error/timeout behavior. Gallery checks cover ordering and deduplication, boundaries, keyboard navigation versus panning, focus after browsing, touch/pen gestures, failed or superseded image loads, refreshed image lists, and narrow-window layouts. Zoom checks cover presets and bounds, focus-scoped shortcuts, browser modifiers, Ctrl-wheel targeting and cursor anchoring, native plain-wheel scrolling, double-click, mouse dragging, resizing, and gallery zoom reset. Compact-layout checks cover the header counter, tall-image space, help disclosure and focus, panel interactions, and narrow/short windows.

Dedicated **`firefox-touch` and `chromium-touch`** projects use viewport-aware fixtures and real tap input to verify portrait/landscape controls, full-width images, scrollable help/presets, orientation and height changes, failed-image recovery, and focus/scroll restoration. Run them alone with:

```sh
npm run test:browser -- --project=firefox-touch --project=chromium-touch
```

Those interaction tests inject the shared content script and stylesheet. A separate Chromium smoke suite loads the **generated Chrome extension** in a persistent browser profile and verifies its manifest-declared injection without injecting those files from the test. Playwright’s [extension-testing guidance](https://playwright.dev/docs/chrome-extensions) recommends bundled Chromium for this automation. Neither suite depends on GitHub’s live markup or verifies store publication, signed installation, or automatic updates.

Validate the actual add-on files with Mozilla’s tooling:

```sh
npm run build
npm run lint:extension
```

`npm run build` already creates an unsigned Firefox ZIP. Mozilla tooling should always use the generated Firefox directory. The [release workflow](docs/releasing.md) signs that package, supplies matching reviewer sources, and publishes the Firefox update feed. Chrome publication and updates use their own distribution channel.

For a live smoke check after installation in each supported desktop browser:

1. Open a PR with a large image in its description, a comment, and an inline Files changed preview. Check Fit, 100%, larger zoom presets, arrow-key scrolling, and all three close methods.
2. Start partway down the PR. Open and close repeatedly; verify the scroll position and focus stay at the opener.
3. Check Ctrl/Cmd-click, Shift-click, middle-click, a normal text link, a badge linking to a website, and GitHub’s review controls.
4. Navigate from another GitHub page into the PR without reloading. Load more comments or switch to Files changed and try a newly rendered image.
5. Use the browser’s network tools to block an image request. Confirm the error message, original-image link, and Escape/close button still work.
6. With multiple images, browse using the screen buttons, arrow keys, and a horizontal touch swipe. Check the counter and endpoints, skip a failed image, and confirm Actual size keeps keyboard panning. Browse away from the original image before closing and check focus/scroll restoration. On a single-image page, check that arrows and the counter are hidden.
7. Try Ctrl-wheel over the image and over the toolbar/backdrop. Check that image zoom stays under the pointer and only takes that gesture over the image. Check plain scrolling, double-click, mouse dragging, the focused **+ / − / 0 / 1** shortcuts, browser Ctrl/Cmd zoom, and any available physical trackpad/touchscreen.
8. Check a tall image and a long caption. The counter should stay in the header and the image should use the space beneath it. Open help with the mouse and keyboard, scroll its panel in a short window, and use Escape to dismiss help before closing the viewer. Try opening help and zoom presets in turn; only one panel should remain open.

For a Firefox for Android device check after installation:

1. Open a PR partway down the page. Tap an image, close with **×** and the empty backdrop, and confirm the same PR position is restored. With TalkBack, check control labels and focus after closing.
2. Browse several images using the overlaid arrows and horizontal swipes in Fit. Check both boundaries, the counter, and a newly loaded comment after reopening the viewer.
3. Pinch directly on the image, check the Fit and 400% limits, and pan with one finger. Repeat using the 100% and 400% presets, then return to Fit. Confirm panning or a canceled pinch does not switch images or close the viewer, and image zoom leaves the close and zoom controls reachable. Check browser page zoom outside the image separately.
4. Rotate between portrait and landscape and expand/collapse Firefox's toolbar. Keep Fit active, then repeat at manual zoom. Open help and presets in the shortest viewport and scroll to their final entries.
5. Try a failed image, browse past it, and verify **Open original image** and **×** remain available. Check system Back with the viewer and disclosures open, both after navigation and on a directly opened PR; retain **×** as the explicit close control.

The shared viewer source is in [`extension/`](extension/), and browser manifests are in [`manifests/`](manifests/). Install the generated browser package from `dist/`. Tests and Node dependencies are development tools and are not part of either extension.
