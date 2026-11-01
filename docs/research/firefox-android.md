# Firefox for Android support

Research date: **2026-11-01**. Research only: no implementation/dependency/commit changes, browser or APK installation, emulator/device testing, signing, or publishing performed. Recommendations below are engineering judgments; platform behavior is linked to official sources.

## Scope and manifest

Target **Firefox for Android**, with the existing Android floor of **142**. Firefox for iOS cannot install desktop/Android Firefox extensions; do not label this “Firefox mobile” support without naming Android. [Mozilla iOS support](https://support.mozilla.org/en-US/kb/add-ons-firefox-ios)

Repository baseline inspected: `manifests/base.json`, `manifests/firefox.json`, `extension/content.js`, `extension/viewer.css`, and build/test configuration. The extension uses MV3 static GitHub JS/CSS content scripts, no extension APIs or background process, native `dialog.showModal()`, `100dvh`, a stage `ResizeObserver`, explicit controls, and fitted-gallery pointer swipes. It allows native browser pinch; it has no custom two-finger image zoom or `visualViewport` handling.

**Implementation follow-up:** the later 0.6.0 Android fixture check reproduced native image pinching moving the toolbar offscreen. The implementation now handles pinch and one-finger pan on the image itself, while preserving browser gestures outside it. This changes the repository baseline above, not the platform findings below. See the [verification record](../verification/firefox-android-0.6.0.md) for tested behavior and the outstanding Android installation check.

**Keep the shared Firefox artifact and MV3 implementation.** Mozilla announced Android MV3 support with Firefox **128**, including the permissions UI. The Android development guide still recommends MV2 and lists host-permission problems: that broad recommendation conflicts with the release announcement and should not alone trigger an MV2 rewrite. Service-worker support remains a separate limitation, irrelevant to this background-free extension. [Mozilla Firefox 128 announcement](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/), [Android guide caveats](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#manifest-v3-compatibility), [service-worker tracking bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659)

Retain these existing fields:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "gh-image-peek@extensions.local",
    "strict_min_version": "140.0",
    "data_collection_permissions": { "required": ["none"] }
  },
  "gecko_android": { "strict_min_version": "142.0" }
}
```

This excerpt omits unrelated existing metadata. `gecko` supplies shared Firefox settings; `gecko_android` enables Android availability and overrides its version range. Without it, availability is desktop-only; `{}` would inherit the desktop minimum. MV3 signing requires an explicit Gecko ID. [MDN browser-specific settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

The **140 desktop / 142 Android** floors match Mozilla’s built-in data-consent introduction, not the first MV3 versions. New extensions must declare data collection; `required: ["none"]` is the documented no-collection declaration. Retain it if it accurately describes the extension. The minimum is a compatibility declaration, not evidence that this viewer was tested there. [Mozilla data-consent guidance](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)

Static `content_scripts` declares the JS/CSS and matching URLs; Android support does not itself require `scripting`, `activeTab`, a browser action, or a background script. Keep `https://github.com/*` scoped access. MV3 site grants still matter: verify installation permission acceptance and actual injection on GitHub; “no API permissions” does not mean “no site access.” [MDN content scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts), [Mozilla MV3 host-permission changes](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/)

## Temporary development installation: stable or Nightly

Use an already generated **Firefox directory containing the merged root `manifest.json`**, currently `dist/firefox`, rather than the source directory with incomplete/legacy metadata. Commands below are instructions, **not commands executed in this investigation**.

1. Install current `web-ext` (Android guide minimum **7.12.0**) and Platform Tools with `adb` on `PATH`. Install Firefox, enable Android USB debugging and Firefox **Remote debugging via USB**, authorize the computer, and check `adb devices`. Release, Beta, and Nightly are supported. [Mozilla Android setup](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#set-up-your-computer-and-android-emulator-or-device)
2. Complete first-run UI and open a real tab. Run lint, then temporary installation, substituting the actual ADB serial: [Mozilla loading requirements](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#install-and-run-your-extension-in-firefox-for-android), [web-ext flags](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)

   ```sh
   web-ext lint --source-dir dist/firefox
   web-ext run --source-dir dist/firefox --target=firefox-android \
     --adb-device=DEVICE_SERIAL --firefox-apk=org.mozilla.firefox
   ```

   Nightly uses `--firefox-apk=org.mozilla.fenix`; Beta uses `org.mozilla.firefox_beta`. Despite its name, this flag is the **installed Android package ID**, not an APK download path. `--android-device` aliases `--adb-device`. [Mozilla package IDs](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#install-and-run-your-extension-in-firefox-for-android), [command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#--firefox-apk)
3. Open/reload a matching GitHub PR. Inspect the remote tab through desktop Firefox `about:debugging` (enable USB devices, connect, inspect the tab); matching desktop/mobile versions are recommended. Content-script logs belong to the page target. Use `adb logcat` for manifest/install diagnostics. [Firefox remote debugging](https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html#connecting-to-a-remote-device), [Mozilla extension debugging](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#debug-your-extension)

Temporary `web-ext run` accepts unsigned development code and does not create a permanently installed/signed release. Follow any first-run Android permission prompts. Reloading is automatic for edits in the watched directory; rebuilt artifacts and page injection still need verification. Fenix uses its main profile, unlike desktop’s usual disposable profile: prefer a dedicated test browser/device. [Unsigned testing, prompts, and reload](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/), [Android runner implementation](https://github.com/mozilla/web-ext/blob/master/src/extension-runners/firefox-android.js)

## Install from file: distinct from temporary loading

For a persistent installation on **stable**, obtain a **Mozilla-signed XPI**, including for private/unlisted self-distribution. A repository ZIP or renamed unsigned XPI is not made installable by revealing developer menus. Mozilla’s current Android instructions are: save the signed file; **Settings → About Firefox → tap the Firefox logo five times quickly → return to Settings → Install Extension from File → select the file → Add**. The hidden entry may be worded “Install add-on from file.” [Mozilla signed-file installation](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-add-on-from-file-on-android)

This is not Nightly-only: current Fenix source gates the file-install entry on `showSecretDebugMenuThisSession`, with no channel check there. The old Android-before-10 visibility restriction was removed in Firefox **133**; older instructions restricting this to Android 10+ are not current for the 142 floor. [Mozilla settings source](https://github.com/mozilla-firefox/firefox/blob/main/mobile/android/fenix/app/src/main/java/org/mozilla/fenix/settings/SettingsFragment.kt), [Mozilla fix 1880777](https://bugzilla.mozilla.org/show_bug.cgi?id=1880777)

**Nightly** also has the file-install route. For persistent unsigned developer testing, Mozilla documents disabling `xpinstall.signatures.required` in Nightly; its Android QA instructions specifically combine `about:config` → set it to `false` with the hidden file picker. That is a developer configuration, not a stable-user installation path; revealing the picker alone does not disable signing. Prefer temporary `web-ext` loading for unsigned iteration. This research did not verify that flow in a current Nightly build. [Mozilla signature-enforcement guidance](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox#what-are-my-options-if-i-want-to-use-an-unsigned-add-on-advanced-users), [Mozilla Android QA procedure](https://bugzilla.mozilla.org/show_bug.cgi?id=1867717#c6), [current GeckoView signing default](https://github.com/mozilla-firefox/firefox/blob/main/mobile/android/app/geckoview-prefs.js)

No signed GH Image Peek artifact, working install/update pipeline, or AMO listing was established here.

## Emulator and headless pitfalls

- An emulator needs **Firefox installed separately**, a booted/unlocked Android UI, onboarding completed, remote debugging enabled, and an open tab. `web-ext` discovers installed packages and temporarily installs the extension; it does not provision Firefox. Its Android runner ignores desktop-style `--args`, `--start-url`, and profile-copy options. Do not assume desktop `--headless` arguments provide Android automation. [Mozilla Android runner source](https://github.com/mozilla/web-ext/blob/master/src/extension-runners/firefox-android.js)
- Google’s emulator `-no-window` hides the window while retaining ADB access; it does not establish that first-run screens or permission/connection prompts have been handled. Start with a visible emulator for setup and troubleshooting. [Android emulator documentation](https://developer.android.com/studio/run/emulator-commandline#common)
- Use legitimate Mozilla downloads: [release APK directories](https://archive.mozilla.org/pub/fenix/releases/) or [Nightly APK directories](https://archive.mozilla.org/pub/fenix/nightly/). Mozilla’s own emulator instructions require the APK architecture to match the system image, and recommend `arm64-v8a` emulator images on Apple Silicon. Select an actual `.apk`, not an app bundle, for direct installation. No binary was downloaded or tested here. [Mozilla emulator setup](https://mozilla.github.io/ecosystem-platform/reference/mobile-specifics#emulator-setup), [Mozilla APK download guidance](https://support.mozilla.org/en-US/kb/install-firefox-your-phone-or-tablet#install-from-mozillas-download-server)

## Small changes worth validating in the existing viewer

**Keep the viewer in the GitHub page.** Extension actions on Android live in the browser menu, and action popups cover the browser; adding one would introduce another entry point for an already contextual content-script tool. Keep explicit close, previous/next, Fit/100%/zoom, and original-image controls; touch users should not need hover, double-click, or keyboard shortcuts. [Mozilla Android extension UI differences](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/#user-interface)

Mozilla’s extension-specific mobile UX guidance targets **360 × 640 dp**, responsive layout, accessible contrast, and touch targets. Recommendation: compact/wrapping controls with an always-reachable close button, a readable counter, and help/presets that fit short landscape windows. Prefer roughly **48 CSS px** targets where space permits (an implementation target, not a dp/CSS-pixel equivalence claim). The existing 44px minimum deserves real-device review. There is no need to add Material components, fonts, or a UI dependency merely to apply the guidance. [Mozilla mobile-extension UX guidelines](https://extensionworkshop.com/documentation/develop/user-experience-guidelines-for-mobile-extensions/)

### Android Back and native dialog cancellation

Keep the existing `cancel` handler and visible close button. A dialog’s cancelable `cancel` event handles close requests, including mobile Back where the browser routes it. **Do not promise Back dismissal across the declared 142+ range**: Mozilla’s Android Back/CloseWatcher integration and default enablement landed in **149**, later than this minimum. [MDN dialog cancellation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/cancel_event), [Android integration bug 1966467](https://bugzilla.mozilla.org/show_bug.cgi?id=1966467), [enablement bug 1966073](https://bugzilla.mozilla.org/show_bug.cgi?id=1966073)

Even newer versions need checking: an **open, unconfirmed Firefox 157 report** says Back navigates to the home page without firing `cancel` when the tab has no session history. This is a reported failure case, not a reproduced GH Image Peek result. Test a directly opened PR, a tab with prior navigation, and help/presets open. Do not add synthetic history entries as an assumed fix. [Mozilla report 2078173](https://bugzilla.mozilla.org/show_bug.cgi?id=2078173)

### Toolbar resizing, `dvh`, and native pinch

`100dvh` accounts for expanding/retracting browser UI, unlike `vh`/`lvh` sizing; it can resize during scrolling. The spec permits jumps rather than continuous updates during toolbar animation. Keep stage measurements/`ResizeObserver` for image fitting and validate toolbar-expanded/collapsed states and rotation; do not assume every toolbar frame is reflected smoothly. [MDN viewport units](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length#relative_length_units_based_on_viewport), [CSS Values specification](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size)

Native pinch shrinks/moves the **visual viewport** without changing the layout viewport. Consequently, `100dvh`, a fixed dialog, and stage layout measurements alone do not guarantee that the close button stays visible after page pinch. `visualViewport` exposes width/height, offsets, scale, and `resize`/`scroll` events. Recommendation: first measure actual Android behavior; if controls need visible-viewport anchoring, use feature-detected, throttled listeners with cleanup, and distinguish toolbar/rotation changes from native zoom. Avoid resetting image zoom or inverse-scaling the whole dialog on every pinch event: that would compete with the preserved browser zoom. [MDN VisualViewport model and events](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)

### Pointer gestures and evidence limits

The existing fitted-gallery `touch-action: pan-y pinch-zoom` intentionally leaves vertical panning and browser pinch available while reserving horizontal gestures; actual-size/custom zoom should retain native two-axis panning. Browser takeover can issue `pointercancel`; `touch-action` is intersected with ancestors before the gesture and changing it mid-gesture does not alter that gesture. Keep multi-pointer rejection/cancellation and never turn a canceled pinch into gallery navigation or backdrop dismissal. Avoid blanket `touch-action: none`. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)

Pointer capture redirects event delivery; it does not guarantee uninterrupted events when the browser takes a gesture. Test horizontal/diagonal swipes, vertical scrolling, a second finger added mid-swipe, pinch over image/backdrop/controls, and gesture completion outside the stage. [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events#capturing_the_pointer)

Desktop Responsive Design Mode simulates screen size, pixel ratio, user agent, and mouse-to-touch events. Treat it and synthetic pointer tests as layout/logic checks, not proof of Android Back, dynamic toolbars, GeckoView pinch/panning, installation, or physical gesture arbitration. Recommendation: use Firefox on an Android emulator for platform smoke tests and a physical touchscreen for final gesture checks. [Mozilla simulation scope](https://firefox-source-docs.mozilla.org/devtools-user/responsive_design_mode/index.html)

## Concrete path and remaining evidence

Keep the shared MV3 Firefox package and 140/142 metadata; lint the merged artifact, temporarily load it with ADB/`web-ext` on current stable Android, then exercise real GitHub PR images and the checks above. Repeat on 142 if retaining a tested 142 minimum, and on current Nightly for forward compatibility. Verify persistent signed-XPI installation separately when a signed artifact exists. Mozilla’s guide recommends declaring Android compatibility after explicit verification. [Mozilla compatibility guidance](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#check-for-firefox-for-android-compatibility)

**Still unverified:** manifest acceptance/site grants and real static injection; actual 142 behavior; mobile GitHub DOM/image authentication; portrait/landscape and toolbar fit; visual-viewport control reachability after pinch; physical swipe/pan/pinch cancellation; Back across browser versions/history states; TalkBack/focus/scroll restoration; persistent installation, signing, updates, and publication. Lint and desktop tests cannot close these device/runtime gaps. No emulator, device, signing, or publishing result is claimed by this note.
