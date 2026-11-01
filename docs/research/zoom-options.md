# Image zoom options

Research date: 2026-11-01. Scope: Firefox 140+, plain JS/CSS, github.com-only extension. Read the supplied repository instructions and inspected `README.md`, `extension/content.js`, `extension/viewer.css`, and the manifest. This is research for wireframe review; no production implementation or native-device gesture testing was performed.

## Initial-release recommendation — product judgment

Review both grayscale wireframes before implementation. Prefer one compact **header group** replacing Actual size: **−, percentage, +, Fit, 100%**. It keeps actions together and avoids covering screenshot details. A bottom floating group is viable if it reserves space clear of the counter, help, focus outlines, and image; its usable image area must exclude that space. Placement is a design judgment, not a standards requirement.

Start with buttons, focus-scoped shortcuts, and existing native scrolling/panning. Use bounded discrete zoom steps with an exact 100% stop; Fit as the minimum and 400% as an initial maximum are reasonable product choices. Preserve browser zoom and defer custom wheel/pinch zoom, drag-to-pan, sliders, and editable percentages. Every newly selected image should reset to Fit.

**Approved scope for v0.3.0.** The toolbar wireframe and its preset disclosure were selected. The user additionally approved Ctrl-wheel over the loaded image, cursor-anchored zoom, double-click Fit/100%, mouse drag-to-pan, and focused `+ - 0 1` shortcuts. This updates the initial recommendation to defer wheel/drag: Ctrl-wheel intentionally replaces browser zoom over the image only, while the rest of the viewer keeps native wheel behavior. Trackpad pinch events represented as Ctrl-wheel follow the same scope; direct touchscreen pinch remains browser-owned. The sources and implementation considerations below still apply; physical-device gestures require separate verification.

## Controls and accessibility

**Source facts.** WAI's [button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) specifies accessible names, Enter/Space activation, and stable labels for `aria-pressed` toggle buttons. A changing action label instead does not need `aria-pressed`. The [toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) uses arrow keys to move between controls. [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) specifies 24 × 24 CSS-pixel targets, subject to exceptions; larger targets help. [WCAG 2.5.1](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html) requires simple single-pointer alternatives to authored multipoint/path gestures and explicitly gives zoom buttons as an example.

**Recommendation.** Use native `button type="button"` controls in a labeled group, with ordinary Tab navigation; a composite ARIA toolbar would introduce competing arrow-key behavior. Name the symbols “Zoom out” and “Zoom in”; keep visible Fit/100% labels and distinguish the selected preset without color alone. Stable preset buttons can expose `aria-pressed`; neither need be pressed at intermediate zoom. Keep existing 44-pixel hit areas and visible focus. Disable unavailable actions while loading/failed or at limits, handling focus if a focused button becomes disabled. Keep button focus after activation; the stage remains separately tabbable for panning. Announce settled changes such as “Zoom 125 percent” through a polite status, without moving focus or announcing every animation frame; MDN documents [`role="status"`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role) as polite and atomic.

## Keyboard and browser zoom

**Source facts.** Firefox reserves [Ctrl/Cmd +, −, and 0 for page zoom](https://support.mozilla.org/en-US/kb/font-size-and-zoom-increase-size-of-web-pages). [WCAG 2.1.4](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html) requires character shortcuts to be switchable, remappable, or active only when their component has focus; Shift needed to type a symbol does not exempt it. [`KeyboardEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key) reflects the typed character, modifiers, and keyboard layout.

**Recommendation.** While the existing focusable image stage itself has focus: `+` zooms in, `-` out, `0` selects Fit, `1` selects 100%. Optionally accept `=` as a convenience. Match `event.key`, allow Shift when it produces `+`, and leave Ctrl/Meta/Alt combinations untouched. Ignore composing input and editable targets; prevent defaults only for handled image actions. Document these shortcuts beside the stage. Merely opening the modal is insufficient scoping for character shortcuts. Preserve Fit-mode Left/Right browsing; manual zoom/100% retains native arrow-key panning when the stage is focused. Screen gallery arrows always browse.

## Wheel, pinch, and gallery swipes

**Source facts.** MDN says [`wheel`](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event) also represents trackpad input; zoom actions can have `ctrlKey=true`, and canceling wheel events suppresses scrolling/zooming and can delay scrolling. Firefox documents [browser pinch zoom](https://support.mozilla.org/en-US/kb/font-size-and-zoom-increase-size-of-web-pages) and [Ctrl + wheel page zoom](https://support.mozilla.org/en-US/kb/mouse-shortcuts-perform-common-tasks). [`touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) declares browser-owned gestures before a gesture starts; changing it during a gesture has no effect, and browser takeover produces `pointercancel`.

**Recommendation.** Do not intercept wheel or pinch initially: ordinary wheel/two-finger scrolling pans overflowing content; modified wheel and browser pinch retain browser behavior. The documented events do not justify assuming every Ctrl-wheel event uniquely identifies a trackpad pinch. Preserve Fit gallery `touch-action: pan-y pinch-zoom` and its single-pointer horizontal swipe; use native two-axis pan/pinch in inspection mode. Cancel a pending swipe on a second pointer or `pointercancel`, and never convert a pan boundary into a gallery turn. Track Fit as a semantic mode: explicit 100% remains inspection even when a small image also fits. A future custom pinch implementation would need gesture ownership declared in advance and physical-device verification.

## Fit, 100%, anchoring, and minimal APIs

**Source facts.** [`naturalWidth`/`naturalHeight`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/naturalWidth) describe density-corrected intrinsic CSS pixels and can be zero before dimensions are available. PhotoSwipe independently distinguishes [Fit from scale 1/original size](https://photoswipe.com/adjusting-zoom-level/) and exposes [zoom-center and pan coordinates](https://photoswipe.com/methods/). [`getBoundingClientRect()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) supplies viewport-relative geometry; [`scrollTo()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTo) sets element scroll coordinates. [CSS Transforms](https://www.w3.org/TR/css-transforms-1/#transform-rendering) do not resize surrounding layout and can extend, but not shrink, overflow.

**Recommendation / derived math.** For intrinsic dimensions `W,H` and available stage content area `Vw,Vh` after padding/scrollbars, use `fit = min(1, Vw/W, Vh/H)` and rendered dimensions `W*s,H*s`. Thus small images are not enlarged in Fit; **100% means `s=1`, not one image pixel per physical display pixel**. Display `round(100*s)%`, optionally “Fit · 37%”; do not redefine Fit as 100% or multiply image sizing by `devicePixelRatio`.

Button/keyboard zoom should preserve the image point at the viewport center. If pointer zoom is added later, preserve the point under the cursor (or pinch midpoint). For each axis, in stage CSS coordinates:

```text
imagePoint = (oldScroll + anchor - oldImageOffset) / oldScale
newScroll  = newImageOffset + imagePoint * newScale - anchor
```

Offsets include centering/padding. Clamp the result to the new scroll bounds; exact anchoring is impossible at some edges. This is geometric derivation, not a browser-provided zoom algorithm.

Retain the ordinary `<img>` and `overflow:auto` stage. Explicit CSS width/height plus native scrolling is the smallest first approach; a transform-based version would need deliberate scrollable-wrapper sizing and bounds. Keep one scale/mode state and avoid canvas, additional image fetching, dependencies, or permissions. Use [`ResizeObserver`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) on the stage to recompute Fit when its actual content area changes; preserve manual scale and clamp pan after resizing. Batch geometry reads and writes, and coalesce repeated/continuous updates with [`requestAnimationFrame()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), which runs before repaint. Disconnect observers, cancel scheduled work, and clear image-specific state on close/navigation.

Before any release, verify focus, keyboard layouts, narrow windows, browser zoom, large/transparent images, anchoring at boundaries, and real Firefox mouse/trackpad/touch behavior. These remain proposed checks, not test results.
