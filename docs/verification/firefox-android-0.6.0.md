# Firefox for Android verification — 0.6.0

Verified on 2026-11-01 using Firefox 159, installed from Mozilla's official release APK, on the Android 16 Pixel 9a emulator. The desktop/Chrome implementation was committed separately as `c2960f9` before this mobile work.

## What ran on Android

A temporary loopback fixture served the actual `extension/content.js` and `extension/viewer.css` on a PR-shaped path, with two local SVG images and a failing image URL. Native Android input drove Firefox through the device tool.

This exercises the shared viewer in GeckoView. It does **not** exercise Android WebExtension installation, manifest matching, site grants, isolated-world injection, or GitHub's live mobile markup.

Observed results:

- A tap opened the modal with the image fitted, readable counter, and visible close/zoom/gallery controls.
- A native horizontal swipe advanced from image 1 to image 2.
- The 100% preset displayed the larger image and allowed touch panning.
- Native page pinch initially moved the toolbar offscreen. Image-only gesture handling fixed that regression: a two-finger spread changed image zoom to 50% while the toolbar retained its size and position. Panning worked after pinching, and shrinking the gesture returned to Fit without advancing the gallery.
- Gallery buttons still worked after pinching and returning to Fit.
- A failed image retained the error message, original-image link, and close button. Previous recovered to a loaded image.
- Closing with × returned focus to the original image link after browsing other images. A separate native tap on the empty backdrop also closed the viewer and restored that focus.
- Android system Back on a directly opened fixture tab closed the tab and left Firefox rather than simply dismissing the modal. Use × or a backdrop tap; the implementation does not modify GitHub's history to work around browser behavior.

## Automated checks

The shared desktop suites, installed Chromium extension smoke tests, and dedicated touch suites cover 160 passing browser checks. One Chromium-CDP-specific native multitouch test is skipped in the Firefox touch project; actual Android fixture input supplies an additional GeckoView pinch check. Two Chromium tests encountered trace-file deletion during concurrent workspace runs; both passed when rerun with an isolated output directory. Their assertions did not require a code change.

Build tests verify root manifests, package/source byte equality, versioning, icon sizes, minimal permissions, deterministic ZIPs, and stale-file cleanup. Mozilla validation and ZIP integrity checks are also run on the generated Firefox artifact.

## Remaining installation check

Automatic approval review rejected enabling **Remote debugging via USB** because it changes a security setting and exposes a debugging interface. That setting was not changed, and the unsigned add-on was not installed on Android. The [README development instructions](../../README.md#install-in-firefox-for-android) describe Mozilla's temporary `web-ext` installation path once that action is authorized.

The 142 Android compatibility floor, physical hardware gestures, TalkBack, actual device rotation/browser-toolbar transitions, live GitHub content, signed installation, and updates have not been verified by this work. Desktop touch emulation and fixture testing do not establish those results.
