<img src="extension/icons/icon.svg" width="64" height="64" alt="">

# GH Image Peek

Click an image in a GitHub pull request to inspect it in a full-size viewer over the current page, then browse the PR’s other images. Keep your place in the review.

A small Firefox WebExtension built with plain JavaScript and CSS. No build step or runtime dependencies.

## Install temporarily in Firefox

Requires **Firefox 140 or newer on desktop**.

This development build is **unsigned**. Opening the ZIP directly or using **Install Add-on From File…** in the regular add-ons manager produces “This add-on could not be installed because it has not been verified.” Load it through `about:debugging` instead:

1. Download the packaged extension ZIP, or download/clone and extract this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…**.
4. Select the **packaged extension ZIP**, or [`extension/manifest.json`](extension/manifest.json) from the extracted repository. A GitHub source-code ZIP must be extracted first; it is not the packaged extension.
5. Open a GitHub pull request. Refresh GitHub tabs that were already open when you installed the extension.

The temporary add-on lasts until Firefox restarts. When loading from source, click **Reload** next to GH Image Peek in `about:debugging` after code changes, then refresh the GitHub tab. To update a ZIP installation, remove the old temporary add-on and load the new ZIP, then refresh GitHub. There is no toolbar button or settings page.

See Mozilla’s [temporary installation instructions](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

For installation that survives Firefox restarts, the extension must first be [signed by Mozilla](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). An unlisted, signed build can be distributed directly without a public add-ons listing.

## Use

- Click a screenshot or direct image link in a PR description, comment, or inline **Files changed** image preview. Linked images also open with **Enter** when focused.
- Images initially **fit to the window** without stretching small images. Transparent images have a checkerboard background.
- When the page has more than one unique image, use the **← / → screen buttons** or **Left / Right arrow keys** to browse in page order. A counter shows your position, such as **2 of 4**. Navigation stops at the first and last image; single-image pages hide these controls.
- On a touchscreen or with a pen, **swipe horizontally** across a fitted image to browse. Mouse drags, vertical gestures, and multitouch gestures do not change images.
- Choose **Actual size** to inspect the original pixels; scroll with a mouse or trackpad, or use the arrow keys while the image area is focused. Choose **Fit to window** to return.
- In **Actual size**, arrow keys and touch gestures pan the current image. The screen buttons still browse; each newly selected image starts fitted to the window.
- Close with **Escape**, the **×** button, or a click on the empty backdrop. Even after browsing other images, closing restores focus to the image or link you originally clicked and keeps the PR’s scroll position.
- **Tab / Shift+Tab** move between the viewer’s controls and scrollable image area. The page behind the modal is inert.
- **Open original image** opens the source in a new tab when you explicitly choose it. This remains available if the image fails to load or takes longer than 30 seconds.

Ctrl/Cmd-click, Shift-click, Alt-click, middle-click, downloads, and the context menu retain their normal browser behavior. Images linking to documentation, profiles, or other nonimage destinations keep their normal link action. GitHub’s navigation buttons, editing areas, avatars, and other controls are left alone.

The gallery includes recognized images and direct image links currently rendered on the PR page, including images below the fold. Repeated original URLs appear once, and hidden or collapsed content is excluded. The image order stays fixed while the viewer is open; close and reopen it to include newly loaded comments. It does not fetch other PR tabs or load additional comments automatically.

Newly loaded comments and GitHub’s dynamic page navigation work without a refresh after the content script is initially loaded. An open viewer is dismissed when GitHub replaces or caches the page. You can browse past an image that is loading or has failed to load.

## Permissions and privacy

The manifest declares a content script for **`https://github.com/*`**. Firefox may describe this as permission to access data on github.com. It runs across GitHub so that navigating from a repository or issue into a PR works; clicks are intercepted only on numeric PR routes and within recognized image content.

There are **no extra API permissions**, background process, storage, analytics, backend, or third-party services. The extension does not upload, persist, or analyze images or page contents. It displays the original URL using an ordinary browser `<img>` element. Firefox contacts that image’s existing host to load it, with normal browser authentication, content security, and tracking protections. It does not fetch images through a proxy or request access to their hosts.

The manifest explicitly declares no data collection through Firefox’s [built-in data consent mechanism](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Known limitations

- Only **github.com pull requests** are supported, including review comments in Files changed. GitHub Enterprise domains, issues, repository image pages, and other sites are outside this release.
- **Inline Files changed images are supported.** Some GitHub rich image comparisons live inside cross-origin `render.githubusercontent.com` frames. Clicks inside those frames cannot be intercepted with github.com-only access; GitHub’s own comparison controls continue to work.
- Detection is intentionally conservative. Direct image links with familiar file extensions and recognized linked previews work; an extensionless text link without a preview is left alone. Links to GitHub’s `blob` and `tree` pages retain normal navigation (a `blob` link explicitly using `?raw=true` or `?raw=1` can be viewed).
- “Actual size” means the browser’s intrinsic image dimensions in CSS pixels, not physical display pixels. The extension uses the linked original or the preview’s current source; it cannot recover a higher-resolution original when GitHub supplies only a thumbnail.
- Expired private-image URLs, restrictive image-host policies, unsupported formats, or content security policies can prevent loading. Use **Open original image** to try the URL directly. SVGs are displayed as images, never inserted into the page as markup.
- GitHub’s markup can change. Unsupported previews keep their existing behavior. Image editing, zoom steps, image downloading, and preferences are outside this release.
- Firefox for Android has a manifest minimum of 142 but has not been verified; the automated interaction suite runs desktop Firefox.

## Verify changes

Node.js 20+ is needed for development tests, not to install or use the add-on.

```sh
npm ci
npx playwright install firefox
npm run lint
npm test
```

The Playwright suite uses real Firefox and routes GitHub/image requests to local fixtures. It verifies full-resolution opening, viewport fitting and actual-size scrolling, dismissal, focus and scroll restoration, keyboard containment, modified and auxiliary clicks, safe exclusions, new comments, SPA navigation, navigation cleanup, and loading/error/timeout behavior. Gallery checks cover ordering and deduplication, boundaries, keyboard navigation versus panning, focus after browsing, touch/pen gestures, failed or superseded image loads, refreshed image lists, and narrow-window layouts. The tests inject the same content script and stylesheet declared in the manifest; they do not install the add-on or depend on GitHub’s live markup.

Validate the actual add-on files with Mozilla’s tooling:

```sh
npx web-ext lint --source-dir extension
```

To make an unsigned ZIP for the temporary loader, run `npx web-ext build --source-dir extension --artifacts-dir dist`. Permanent distribution requires Mozilla signing.

For a live smoke check after temporary installation:

1. Open a PR with a large image in its description, a comment, and an inline Files changed preview. Check fit, actual size, arrow-key scrolling, and all three close methods.
2. Start partway down the PR. Open and close repeatedly; verify the scroll position and focus stay at the opener.
3. Check Ctrl/Cmd-click, Shift-click, middle-click, a normal text link, a badge linking to a website, and GitHub’s review controls.
4. Navigate from another GitHub page into the PR without reloading. Load more comments or switch to Files changed and try a newly rendered image.
5. Use Firefox’s network tools to block an image request. Confirm the error message, original-image link, and Escape/close button still work.
6. With multiple images, browse using the screen buttons, arrow keys, and a horizontal touch swipe. Check the counter and endpoints, skip a failed image, and confirm Actual size keeps keyboard panning. Browse away from the original image before closing and check focus/scroll restoration. On a single-image page, check that arrows and the counter are hidden.

The installable files are all in [`extension/`](extension/). Tests and Node dependencies are development tools and are not part of the add-on.
