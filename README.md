<img src="extension/icons/icon.svg" width="64" height="64" alt="">

# GH Image Peek

A browser extension that opens images in GitHub pull requests in a full-size viewer on top of the page. You can zoom, pan, and step through the other images in the PR, and closing the viewer puts you back where you were.

Supports Firefox (desktop and Android) and Chrome (desktop). Plain JavaScript and CSS, no runtime dependencies.

## Install

### Firefox

Download `gh-image-peek-firefox-X.Y.Z.xpi` from [Releases](https://github.com/MohamadJaara/gh-image-peek/releases), open `about:addons`, and choose **Install Add-on From File…** from the gear menu. Signed releases update themselves through the GitHub update feed.

No signed release has been published yet. Until one is, load the unsigned build as a temporary add-on (Firefox 140+):

1. Download `gh-image-peek-firefox-X.Y.Z.zip`, or [build from source](#development).
2. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**.
3. Select the ZIP or `dist/firefox/manifest.json`.

Temporary add-ons are removed when Firefox restarts.

### Chrome

1. Download and extract `gh-image-peek-chrome-X.Y.Z.zip`, or [build from source](#development).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder (or `dist/chrome/`).

The extension isn't on the Chrome Web Store, so updates are manual.

### Firefox for Android

Requires Firefox 142+. There's no signed Android build yet, so for now it runs only as a temporary add-on pushed from a computer with [`web-ext`](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/). Turn on USB debugging on the device and **Remote debugging via USB** in Firefox's settings, then run:

```sh
npm run build
adb devices
npx web-ext run --source-dir dist/firefox --target=firefox-android \
  --adb-device=DEVICE_SERIAL --firefox-apk=org.mozilla.firefox
```

For Beta use `org.mozilla.firefox_beta`; for Nightly use `org.mozilla.fenix`.

After installing, refresh any GitHub tabs that were already open.

## Usage

Click (or tap) an image in a PR description, a comment, or an inline image diff under **Files changed**. Links that point directly at an image also open in the viewer.

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Next / previous image | `←` `→` or the arrow buttons | Swipe horizontally |
| Zoom | `+` `−`, Ctrl + scroll over the image, or the toolbar | Pinch on the image |
| Fit / 100% | `0` / `1`, or double-click to toggle | Toolbar presets |
| Pan when zoomed | Drag, scroll, or arrow keys | Drag |
| Close | `Esc`, `×`, or click the backdrop | `×` |

Keyboard zoom shortcuts work while the image has focus. The `?` button lists every shortcut. **Open original image** opens the source in a new tab.

Ctrl/Cmd-click, middle-click, Shift-click, and right-click keep their normal browser behavior. Links to anything other than an image, like docs, badges, or profiles, aren't intercepted.

## Privacy

The extension runs a content script on `https://github.com/*` and asks for no other permissions. It has no background script, no storage, no analytics, and makes no network requests of its own. Images load through a normal `<img>` tag straight from wherever GitHub hosts them.

## Limitations

- Only pull requests on github.com. GitHub Enterprise, issues, and other pages aren't supported.
- Rich image diffs that GitHub renders inside `render.githubusercontent.com` iframes can't be intercepted.
- The gallery contains the images rendered on the page when you open the viewer. To pick up comments that load later, close the viewer and open it again.
- If GitHub only serves a thumbnail, that thumbnail is what you get.
- On Android, the system Back button may not close the viewer. Use `×`.
- Firefox for iOS and mobile Chrome don't support extensions like this one.

## Development

Requires Node.js 24 (or 22.13+).

```sh
npm ci
npm run build   # writes dist/firefox/, dist/chrome/, and unsigned ZIPs
```

Viewer source is in [`extension/`](extension/). Per-browser manifests are generated from [`manifests/`](manifests/). Don't edit anything in `dist/`, because the build overwrites it.

After a change, rebuild, reload the extension (`about:debugging` or `chrome://extensions`), and refresh the GitHub tab.

```sh
npx playwright install firefox chromium
npm run lint
npm run lint:extension   # Mozilla's web-ext lint on dist/firefox
npm test                 # build checks + Playwright in Firefox and Chromium
```

Run `npm run icons` after editing `extension/icons/icon.svg` to regenerate the PNG icons.

More docs:

- [Testing](docs/testing.md): what the automated suite covers and the manual checklists
- [Releasing](docs/releasing.md): signing, version tags, and the Firefox update feed
- [Maintenance](docs/maintenance.md): CI workflows, Renovate, and repository settings
