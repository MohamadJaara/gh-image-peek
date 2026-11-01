(() => {
  "use strict";

  // One delegated listener survives GitHub's Turbo/PJAX navigation and lazy loading.
  const prPath = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/;
  const imageExtension = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
  const imageScope = '.markdown-body, .js-file-content, .file .data, .image-diff, [data-testid="image-diff"]';
  const imageCandidates = imageScope.split(", ").map((scope) => `${scope} img, ${scope} a[href]`).join(", ");
  const controls = 'button, input, textarea, select, summary, [role="button"], [role="menuitem"], [role="tab"], [contenteditable]:not([contenteditable="false"])';
  let viewer = null;

  function webURL(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      return ["https:", "http:"].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function isGitHubFilePage(url) {
    if (url.hostname !== "github.com") return false;
    return /^\/[^/]+\/[^/]+\/tree\//.test(url.pathname) ||
      (/^\/[^/]+\/[^/]+\/blob\//.test(url.pathname) &&
        !["true", "1"].includes(url.searchParams.get("raw")));
  }

  function isImageEndpoint(url) {
    return url.hostname === "github.com" && (
      /^\/user-attachments\/assets\/[^/]+\/?$/.test(url.pathname) ||
      /^\/[^/]+\/[^/]+\/(?:assets|raw)\//.test(url.pathname)
    );
  }

  function sameResource(a, b) {
    if (!a || !b) return false;
    return a.href.split("#")[0] === b.href.split("#")[0];
  }

  function imageFrom(target) {
    if (!(target instanceof Element) || !target.closest(imageScope) ||
        target.closest(controls) || target.closest("[data-gh-image-peek]")) return null;

    const link = target.closest("a[href]");
    if (link?.hasAttribute("download")) return null;
    const preview = target.closest("img") || link?.querySelector("img");
    if (preview?.matches('.avatar, .emoji, [data-emoji], [role="presentation"]')) return null;

    const source = webURL(preview?.currentSrc || preview?.src);
    if (link) {
      const destination = webURL(link.getAttribute("href"));
      if (!destination || isGitHubFilePage(destination)) return null;

      // A preview alone does not make its link an image: badges often link to apps,
      // profiles, or documentation. Keep those destinations working normally.
      const directImage = imageExtension.test(destination.pathname);
      if (!directImage && !(preview && (sameResource(source, destination) ||
          sameResource(webURL(preview.src), destination) || isImageEndpoint(destination)))) return null;
      return { url: destination.href, alt: preview?.alt || "Pull request image", opener: link };
    }

    return source ? { url: source.href, alt: preview.alt || "Pull request image", opener: preview } : null;
  }

  function element(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }

  function collectImages(clicked) {
    const images = [];
    const seen = new Set();
    const key = (image) => image.url.split("#")[0];
    for (const node of document.querySelectorAll(imageCandidates)) {
      // Offscreen images are included, but hidden/collapsed comments are not.
      if (!node.getClientRects().length || getComputedStyle(node).visibility !== "visible" ||
          node.closest("details:not([open]), [hidden], [inert]")) continue;
      const candidate = imageFrom(node);
      if (!candidate || seen.has(key(candidate))) continue;
      seen.add(key(candidate));
      images.push(candidate);
    }
    let index = images.findIndex((image) => key(image) === key(clicked));
    if (index < 0) index = images.push(clicked) - 1;
    // A repeated screenshot may have a different caption in each comment.
    images[index] = clicked;
    return { images, index };
  }

  function openViewer(image) {
    if (viewer || !document.body) return;

    // Keep order stable while browsing; newly rendered comments are picked up
    // the next time the viewer opens, without downloading/preloading anything.
    const gallery = collectImages(image);
    const multiple = gallery.images.length > 1;
    let index = gallery.index;

    const before = {
      x: window.scrollX,
      y: window.scrollY,
      url: location.href,
      focused: document.activeElement,
      overflow: ["overflow-x", "overflow-y"].map((name) => [
        name,
        document.documentElement.style.getPropertyValue(name),
        document.documentElement.style.getPropertyPriority(name),
      ]),
    };
    const dialog = element("dialog", {
      "data-gh-image-peek": "",
      "data-size": "fit",
      "aria-label": "Image viewer",
      "aria-modal": "true",
    });
    const toolbar = element("div", { "data-peek-toolbar": "" });
    const closeButton = element("button", { type: "button", "aria-label": "Close image viewer", title: "Close (Escape)" }, "×");
    const heading = element("div", { "data-peek-heading": "" });
    const caption = element("span", { "data-peek-caption": "", title: image.alt }, image.alt);
    const meta = element("div", { "data-peek-meta": "" });
    const counter = element("span", { "data-peek-counter": "", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    counter.hidden = !multiple;
    meta.append(caption, counter);
    heading.append(element("strong", {}, "Image peek"), meta);
    const zoomControls = element("div", { "data-peek-zoom": "", role: "group", "aria-label": "Image zoom" });
    const zoomOut = element("button", { type: "button", disabled: "", "aria-label": "Zoom out", title: "Zoom out (− with image focused)" }, "−");
    const zoomPresets = element("button", { type: "button", disabled: "", "aria-label": "Zoom presets", "aria-expanded": "false", "aria-controls": "gh-image-peek-presets" }, "Fit ▾");
    const zoomIn = element("button", { type: "button", disabled: "", "aria-label": "Zoom in", title: "Zoom in (+ with image focused)" }, "+");
    const presets = element("div", { "data-peek-presets": "", id: "gh-image-peek-presets", role: "group", "aria-label": "Zoom presets", hidden: "" });
    const presetButtons = [
      ["fit", "Fit to window"], ["1", "100% · actual size"], ["2", "200%"], ["4", "400%"],
    ].map(([value, label]) => element("button", { type: "button", "data-peek-scale": value, "aria-label": label }, label));
    presets.append(...presetButtons);
    zoomControls.append(zoomOut, zoomPresets, zoomIn, presets);
    const original = element("a", { href: image.url, target: "_blank", rel: "noopener noreferrer", "aria-label": "Open original image" }, "Open original");
    const helpWrap = element("div", { "data-peek-help-wrap": "" });
    const helpButton = element("button", { type: "button", "data-peek-help-button": "", "aria-label": "Keyboard shortcuts", "aria-expanded": "false", "aria-controls": "gh-image-peek-help-panel", title: "Keyboard shortcuts and gestures" }, "?");
    const helpPanel = element("div", { "data-peek-help-panel": "", id: "gh-image-peek-help-panel", role: "region", "aria-label": "Keyboard shortcuts", tabindex: "0", hidden: "" });
    const help = element("p", { "data-peek-help": "" });
    const shortcutList = element("dl");
    for (const [keys, action] of [
      ["Swipe ← / →", "Browse fitted images with touch or pen"],
      ["− / + buttons", "Zoom with touch or mouse"],
      ["Touch drag", "Pan a zoomed image"],
      ["Pinch the image", "Zoom the image while controls stay in place"],
      ["← / →", "Browse in Fit; pan when zoomed"],
      ["Ctrl + wheel", "Zoom over the image"],
      ["+ / −", "Zoom with image focused"],
      ["0 / 1", "Fit / actual size with image focused"],
      ["Double-click", "Toggle Fit and 100%"],
      ["Drag", "Pan a zoomed image"],
      ["Escape", "Close this panel, then the viewer"],
    ]) shortcutList.append(element("dt", {}, keys), element("dd", {}, action));
    helpPanel.append(element("strong", {}, "Shortcuts & gestures"), shortcutList, help,
      element("p", { "data-peek-scope": "" }, "Browsing images currently loaded on this PR page. New images appear when you reopen the viewer."));
    helpWrap.append(helpButton, helpPanel);
    toolbar.append(closeButton, heading, zoomControls, original, helpWrap);

    const frame = element("div", { "data-peek-gallery": "" });
    if (!multiple) frame.setAttribute("data-single", "");
    const previous = element("button", { type: "button", "data-peek-nav": "previous", "aria-label": "Previous image", title: "Previous image (←)" }, "←");
    const next = element("button", { type: "button", "data-peek-nav": "next", "aria-label": "Next image", title: "Next image (→)" }, "→");
    previous.hidden = next.hidden = !multiple;
    const stage = element("div", { "data-peek-stage": "", role: "region", tabindex: "0", "aria-label": "Image fit to window.", "aria-describedby": "gh-image-peek-shortcuts" });
    const status = element("div", { "data-peek-status": "", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    stage.append(status);
    frame.append(previous, stage, next);
    const shortcuts = element("p", { "data-peek-sr": "", id: "gh-image-peek-shortcuts" }, "Swipe horizontally to browse fitted images, or use the previous and next buttons. Pinch the image, or use the zoom buttons or presets to inspect details, then drag to pan. With the image focused: + and − zoom, 0 fits to window, 1 selects actual size. Double-click toggles Fit and 100%. Ctrl plus mouse wheel over the image zooms around the pointer.");
    const zoomStatus = element("div", { "data-peek-sr": "", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    dialog.append(toolbar, frame, shortcuts, zoomStatus);

    let timer;
    let closed = false;
    let picture;
    let loadState;
    let scale = 1;
    let wheelFrame = 0;
    let wheelDelta = 0;
    let wheelAnchor;
    let resizeFrame = 0;
    let zoomAnnouncement;
    let pan = null;
    let backdropStart = false;
    let suppressSwipeClick = false;
    let swipe = null;
    let pinch = null;
    let touchBlocked = false;
    const pointers = new Set();
    const touches = new Map();
    const zoomSteps = [1 / 64, 1 / 32, 1 / 16, 1 / 8, .25, .5, .75, 1, 1.25, 1.5, 2, 3, 4];
    const resizeObserver = new ResizeObserver(() => {
      if (loadState !== "ready") return;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        setZoom(scale, { mode: dialog.dataset.size, preserveScale: true });
      });
    });

    function close({ navigating = false } = {}) {
      if (closed) return;
      closed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      cancelWheel();
      clearPan();
      clearTouches();
      clearTimeout(zoomAnnouncement);
      clearTimeout(timer);
      if (picture) picture.onload = picture.onerror = null;
      window.removeEventListener("keydown", onKeydown, true);
      // Closing a dialog can natively restore focus; scroll restoration below also
      // covers that browser behavior, but never overwrites a new page's position.
      dialog.close();
      dialog.remove();
      const root = document.documentElement;
      for (const [name, value, priority] of before.overflow) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
      viewer = null;

      if (!navigating && location.href === before.url) {
        const focusTarget = image.opener?.isConnected ? image.opener : before.focused;
        if (focusTarget?.isConnected && focusTarget !== document.body) {
          // Standalone Markdown images are not normally focusable. Make only the
          // clicked image programmatically focusable until focus leaves it.
          if (!focusTarget.hasAttribute("tabindex") && focusTarget.tabIndex < 0) {
            focusTarget.setAttribute("tabindex", "-1");
            focusTarget.addEventListener("blur", () => focusTarget.removeAttribute("tabindex"), { once: true });
          }
          focusTarget.focus({ preventScroll: true });
        }
        window.scrollTo({ left: before.x, top: before.y, behavior: "instant" });
      }
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!helpPanel.hidden) closeHelp(true);
        else if (!presets.hidden) closePresets(true);
        else close();
      } else if (event.key === "Tab") {
        const stops = [...dialog.querySelectorAll('button:not(:disabled), a[href], [data-peek-stage], [data-peek-help-panel]')]
          .filter((node) => node.getClientRects().length);
        const focusedIndex = stops.indexOf(document.activeElement);
        if (event.shiftKey && focusedIndex <= 0) {
          event.preventDefault();
          stops.at(-1).focus();
        } else if (!event.shiftKey && (focusedIndex === -1 || focusedIndex === stops.length - 1)) {
          event.preventDefault();
          closeButton.focus();
        }
        // Do not let GitHub's single-key shortcuts act on the page behind us.
        event.stopPropagation();
      } else if (loadState === "ready" && document.activeElement === stage && presets.hidden && helpPanel.hidden &&
          !event.defaultPrevented && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey &&
          ["+", "=", "-", "0", "1"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        cancelWheel();
        if (event.key === "0") setZoom(scale, { mode: "fit" });
        else if (event.key === "1") setZoom(1);
        else stepZoom(event.key === "-" ? -1 : 1);
      } else if (presets.hidden && helpPanel.hidden && multiple && dialog.dataset.size === "fit" && !event.isComposing &&
          !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
          ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        move(event.key === "ArrowRight" ? 1 : -1);
      } else {
        event.stopPropagation();
      }
    }

    function updateHelp() {
      if (loadState === "error") {
        help.textContent = multiple
          ? "Try “Open original image”, use the arrows to continue, or close with ×."
          : "Try “Open original image”, or close with × to return to the pull request.";
      } else if (dialog.dataset.size === "actual") {
        help.textContent = multiple
          ? "Drag or scroll to pan · Select Fit to browse with a swipe · Screen arrows always browse"
          : "Drag or scroll to pan · Select Fit to see the whole image · Close with ×";
      } else {
        help.textContent = multiple
          ? "Swipe or use ← → to browse · Use − / + or presets to zoom · Close with ×"
          : "Use − / + or presets to zoom · Close with ×";
      }
    }

    function closePresets(focus = false) {
      presets.hidden = true;
      zoomPresets.setAttribute("aria-expanded", "false");
      if (focus) zoomPresets.focus({ preventScroll: true });
    }

    function closeHelp(focus = false) {
      helpPanel.hidden = true;
      helpButton.setAttribute("aria-expanded", "false");
      if (focus) helpButton.focus({ preventScroll: true });
    }

    function cancelWheel() {
      cancelAnimationFrame(wheelFrame);
      wheelFrame = 0;
      wheelDelta = 0;
    }

    function clearPan() {
      const previousPan = pan;
      pan = null;
      dialog.removeAttribute("data-peek-dragging");
      if (previousPan?.node.hasPointerCapture(previousPan.id)) previousPan.node.releasePointerCapture(previousPan.id);
    }

    function clearTouches() {
      const captured = [...pointers];
      pointers.clear();
      touches.clear();
      pinch = swipe = null;
      touchBlocked = backdropStart = false;
      for (const id of captured) {
        if (picture?.hasPointerCapture(id)) picture.releasePointerCapture(id);
        if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
      }
    }

    function fitScale() {
      const bounds = stage.getBoundingClientRect();
      const style = getComputedStyle(stage);
      // Fit excludes padding/borders and assumes its own scrollbars disappear.
      const width = bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      const height = bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) -
        parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
      return Math.max(.0001, Math.min(1, width / picture.naturalWidth, height / picture.naturalHeight));
    }

    function updateZoomControls() {
      const focused = document.activeElement;
      const ready = loadState === "ready";
      const fitted = dialog.dataset.size === "fit";
      zoomOut.disabled = !ready || scale <= fitScale() + .00001;
      zoomIn.disabled = !ready || scale >= 4;
      zoomPresets.disabled = !ready;
      zoomPresets.textContent = fitted ? "Fit ▾" : `${Math.round(scale * 100)}% ▾`;
      zoomPresets.setAttribute("aria-description", fitted ? "Fit to window" : `Current zoom: ${Math.round(scale * 100)} percent`);
      for (const button of presetButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.peekScale === "fit" ? fitted : !fitted && Math.abs(scale - Number(button.dataset.peekScale)) < .00001));
      }
      if ((focused === zoomIn && zoomIn.disabled) ||
          (focused === zoomOut && zoomOut.disabled)) stage.focus({ preventScroll: true });
    }

    function setZoom(value, { mode = "actual", anchor, imagePoint: pinnedPoint, preserveScale = false } = {}) {
      if (closed || loadState !== "ready") return;
      const fitted = mode === "fit";
      const bounds = stage.getBoundingClientRect();
      const point = anchor || { x: bounds.left + stage.clientLeft + stage.clientWidth / 2, y: bounds.top + stage.clientTop + stage.clientHeight / 2 };
      const oldBounds = picture.getBoundingClientRect();
      const imagePoint = pinnedPoint || { x: (point.x - oldBounds.left) / scale, y: (point.y - oldBounds.top) / scale };
      scale = fitted ? fitScale() : Math.min(4, Math.max(preserveScale ? .0001 : fitScale(), value));
      dialog.dataset.size = fitted ? "fit" : "actual";
      picture.style.width = `${picture.naturalWidth * scale}px`;
      picture.style.height = `${picture.naturalHeight * scale}px`;
      if (fitted) stage.scrollTo({ left: 0, top: 0, behavior: "instant" });
      else {
        const newBounds = picture.getBoundingClientRect();
        stage.scrollTo({
          left: stage.scrollLeft + newBounds.left + imagePoint.x * scale - point.x,
          top: stage.scrollTop + newBounds.top + imagePoint.y * scale - point.y,
          behavior: "instant",
        });
      }
      dialog.toggleAttribute("data-peek-can-pan", !fitted && (stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1));
      stage.setAttribute("aria-label", fitted ? "Image fit to window." : `Image at ${Math.round(scale * 100)} percent. Drag or use arrow keys to scroll.`);
      updateZoomControls();
      updateHelp();
      clearTimeout(zoomAnnouncement);
      zoomAnnouncement = window.setTimeout(() => {
        zoomStatus.textContent = fitted ? "Image fitted to window" : `Image zoom ${Math.round(scale * 100)} percent`;
      }, 150);
    }

    function stepZoom(direction) {
      const minimum = fitScale();
      const stops = [minimum, ...zoomSteps.filter((step) => step > minimum + .00001)];
      const destination = direction > 0
        ? stops.find((step) => step > scale + .00001) ?? 4
        : stops.findLast((step) => step < scale - .00001) ?? minimum;
      setZoom(destination, { mode: destination <= minimum + .00001 ? "fit" : "actual" });
    }

    function loadImage() {
      const focused = document.activeElement;
      cancelWheel();
      clearPan();
      clearTouches();
      closePresets();
      closeHelp();
      cancelAnimationFrame(resizeFrame);
      clearTimeout(zoomAnnouncement);
      zoomStatus.textContent = "";
      clearTimeout(timer);
      if (picture) {
        picture.onload = picture.onerror = null;
        picture.remove();
      }
      const current = gallery.images[index];
      // A fresh element ties each load/error event to its own request. A late
      // response or timeout for an image we left cannot update the current one.
      const loading = element("img", { "data-peek-image": "", alt: current.alt, hidden: "", draggable: "false" });
      picture = loading;
      stage.append(loading);
      caption.textContent = current.alt;
      caption.title = current.alt;
      original.href = current.url;
      counter.textContent = `${index + 1} / ${gallery.images.length}`;
      counter.setAttribute("aria-label", `Image ${index + 1} of ${gallery.images.length}`);
      previous.disabled = index === 0;
      next.disabled = index === gallery.images.length - 1;
      dialog.dataset.size = "fit";
      dialog.removeAttribute("data-peek-can-pan");
      scale = 1;
      stage.setAttribute("aria-label", "Image fit to window.");
      stage.setAttribute("aria-busy", "true");
      status.textContent = "Loading image…";
      loadState = status.dataset.state = "loading";
      updateZoomControls();
      updateHelp();
      stage.scrollTo({ left: 0, top: 0, behavior: "instant" });

      if ([previous, next, zoomIn, zoomOut, zoomPresets].some((button) => button === focused && button.disabled)) {
        stage.focus({ preventScroll: true });
      }

      function failed() {
        if (closed || picture !== loading) return;
        clearTimeout(timer);
        loading.onload = loading.onerror = null;
        loading.hidden = true;
        status.textContent = "This image could not be loaded.";
        loadState = status.dataset.state = "error";
        updateZoomControls();
        updateHelp();
        stage.setAttribute("aria-busy", "false");
      }

      loading.onload = () => {
        if (closed || picture !== loading) return;
        if (!loading.naturalWidth || !loading.naturalHeight) {
          failed();
          return;
        }
        clearTimeout(timer);
        loading.hidden = false;
        status.textContent = `${loading.naturalWidth.toLocaleString()} × ${loading.naturalHeight.toLocaleString()} pixels`;
        loadState = status.dataset.state = "ready";
        stage.setAttribute("aria-busy", "false");
        setZoom(scale, { mode: "fit" });
      };
      loading.onerror = failed;
      timer = window.setTimeout(failed, 30000);
      loading.src = current.url;
    }

    function move(delta) {
      const destination = index + delta;
      if (destination < 0 || destination >= gallery.images.length) return;
      index = destination;
      loadImage();
    }

    previous.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
    zoomOut.addEventListener("click", () => { cancelWheel(); stepZoom(-1); });
    zoomIn.addEventListener("click", () => { cancelWheel(); stepZoom(1); });
    zoomPresets.addEventListener("click", () => {
      closeHelp();
      presets.hidden = !presets.hidden;
      zoomPresets.setAttribute("aria-expanded", String(!presets.hidden));
    });
    helpButton.addEventListener("click", () => {
      closePresets();
      helpPanel.hidden = !helpPanel.hidden;
      helpButton.setAttribute("aria-expanded", String(!helpPanel.hidden));
    });
    for (const button of presetButtons) button.addEventListener("click", () => {
      cancelWheel();
      if (button.dataset.peekScale === "fit") setZoom(scale, { mode: "fit" });
      else setZoom(Number(button.dataset.peekScale));
      closePresets();
      stage.focus({ preventScroll: true });
    });
    stage.addEventListener("wheel", (event) => {
      if (loadState !== "ready" || event.target !== picture || !event.ctrlKey ||
          event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented ||
          !event.cancelable || !Number.isFinite(event.deltaY) || event.deltaY === 0 ||
          ![0, 1, 2].includes(event.deltaMode)) return;
      // This intentionally takes browser zoom only over the loaded image. Pinch
      // devices may emit the same Ctrl-wheel events; do not guess device types.
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      wheelDelta = Math.max(-480, Math.min(480, wheelDelta + event.deltaY * unit));
      wheelAnchor = { x: event.clientX, y: event.clientY };
      if (!wheelFrame) wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        const target = scale * Math.exp(-wheelDelta * .002);
        wheelDelta = 0;
        setZoom(target, { mode: target <= fitScale() + .00001 ? "fit" : "actual", anchor: wheelAnchor });
      });
    }, { passive: false });
    stage.addEventListener("dblclick", (event) => {
      if (loadState !== "ready" || event.target !== picture || event.button !== 0 ||
          event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented || suppressSwipeClick) return;
      event.preventDefault();
      cancelWheel();
      clearPan();
      if (dialog.dataset.size === "fit") setZoom(1, { anchor: { x: event.clientX, y: event.clientY } });
      else setZoom(scale, { mode: "fit" });
      stage.focus({ preventScroll: true });
    });
    closeButton.addEventListener("click", () => close());
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!helpPanel.hidden) closeHelp(true);
      else if (!presets.hidden) closePresets(true);
      else close();
    });
    dialog.addEventListener("close", () => close());
    // Require both ends of the pointer gesture on empty space so a drag that
    // starts on the image and ends on the backdrop does not dismiss the viewer.
    dialog.addEventListener("pointerdown", (event) => {
      if (!zoomControls.contains(event.target)) closePresets();
      if (!helpWrap.contains(event.target)) closeHelp();
      suppressSwipeClick = false;
      backdropStart = event.target === stage || event.target === dialog;
      const touch = event.pointerType === "touch";
      const directPointer = touch || event.pointerType === "pen";
      if (directPointer) pointers.add(event.pointerId);
      const unmodified = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      const imageTouch = touch && event.target === picture && loadState === "ready" &&
        event.button === 0 && unmodified && Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
      if (imageTouch) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        try { picture.setPointerCapture(event.pointerId); } catch { /* No active pointer. */ }
      }
      if (directPointer && pointers.size > 1) {
        swipe = null;
        clearPan();
        backdropStart = false;
        suppressSwipeClick = true;
        for (const id of touches.keys()) {
          try { picture.setPointerCapture(id); } catch { /* No active pointer. */ }
        }
        if (!touchBlocked && pointers.size === 2 && touches.size === 2) {
          const [a, b] = [...touches.values()];
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          if (Number.isFinite(distance) && distance > 0) {
            const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const bounds = picture.getBoundingClientRect();
            cancelWheel();
            pinch = {
              distance, scale,
              point: { x: (center.x - bounds.left) / scale, y: (center.y - bounds.top) / scale },
            };
          }
        } else pinch = null;
        // Once a pinch ends, wait for all fingers to lift before allowing a new
        // drag or gallery swipe. A third pointer also cancels the transform.
        touchBlocked = true;
        return;
      }
      if (directPointer && touchBlocked) return;
      if (event.target === picture && loadState === "ready" && event.button === 0) {
        stage.focus({ preventScroll: true });
        if ((event.pointerType === "mouse" || imageTouch || event.pointerType === "pen") &&
            dialog.hasAttribute("data-peek-can-pan") && unmodified) {
          pan = { id: event.pointerId, node: picture, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
          dialog.setAttribute("data-peek-dragging", "");
          try { picture.setPointerCapture(event.pointerId); } catch { /* No active pointer. */ }
          event.preventDefault();
        }
      }
      if (!directPointer) return;
      if (!multiple || dialog.dataset.size !== "fit" || pointers.size !== 1 ||
          !event.isPrimary || event.button !== 0 || !stage.contains(event.target)) {
        swipe = null;
        return;
      }
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
      // Capture lets a swipe finish outside the image area. Synthetic events in
      // tests or canceled pointers may not have an active pointer to capture.
      try { (imageTouch ? picture : stage).setPointerCapture(event.pointerId); } catch { /* No active pointer. */ }
    });
    dialog.addEventListener("pointermove", (event) => {
      if (touches.has(event.pointerId) && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinch) {
          const [a, b] = [...touches.values()];
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          if (Number.isFinite(distance)) {
            const value = pinch.scale * distance / pinch.distance;
            setZoom(value, {
              mode: value <= fitScale() + .00001 ? "fit" : "actual",
              anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
              imagePoint: pinch.point,
            });
          }
          return;
        }
      }
      if (touchBlocked && ["touch", "pen"].includes(event.pointerType)) return;
      if (pan?.id === event.pointerId) {
        backdropStart = false;
        if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 8) suppressSwipeClick = true;
        stage.scrollTo({ left: pan.left + pan.x - event.clientX, top: pan.top + pan.y - event.clientY, behavior: "instant" });
      }
      if (swipe?.id === event.pointerId &&
          Math.hypot(event.clientX - swipe.x, event.clientY - swipe.y) > 8) backdropStart = false;
    });
    dialog.addEventListener("pointerup", (event) => {
      if (pan?.id === event.pointerId) clearPan();
      pointers.delete(event.pointerId);
      touches.delete(event.pointerId);
      if (touchBlocked) {
        pinch = swipe = null;
        backdropStart = false;
        suppressSwipeClick = true;
        if (!pointers.size) touchBlocked = false;
        return;
      }
      if (swipe?.id !== event.pointerId) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      swipe = null;
      if (dialog.dataset.size === "fit" && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        backdropStart = false;
        suppressSwipeClick = true;
        move(dx < 0 ? 1 : -1);
      }
    });
    dialog.addEventListener("pointercancel", (event) => {
      if (pan?.id === event.pointerId) clearPan();
      pointers.delete(event.pointerId);
      touches.clear();
      pinch = null;
      touchBlocked = pointers.size > 0;
      suppressSwipeClick = true;
      swipe = null;
      backdropStart = false;
    });
    dialog.addEventListener("lostpointercapture", (event) => {
      if (pan?.id === event.pointerId) clearPan();
    });
    dialog.addEventListener("click", (event) => {
      if (!suppressSwipeClick && backdropStart && (event.target === stage || event.target === dialog)) close();
      backdropStart = false;
      event.stopPropagation();
    });

    viewer = { close, dialog, url: before.url };
    document.body.append(dialog);
    document.documentElement.style.setProperty("overflow", "hidden", "important");
    dialog.showModal();
    closeButton.focus({ preventScroll: true });
    window.addEventListener("keydown", onKeydown, true);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    resizeObserver.observe(stage);
    loadImage();
  }

  document.addEventListener("click", (event) => {
    if (viewer || event.defaultPrevented || !event.cancelable || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        !prPath.test(location.pathname)) return;
    const image = imageFrom(event.target);
    if (!image) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openViewer(image);
  }, true);

  function navigating() {
    viewer?.close({ navigating: true });
  }
  for (const name of ["turbo:before-cache", "turbo:before-render", "pjax:beforeReplace"]) {
    document.addEventListener(name, navigating);
  }
  window.addEventListener("popstate", navigating);
  window.addEventListener("pagehide", navigating);
  // React navigations can replace the body without Turbo events. Observe only
  // while open, to release the scroll lock if GitHub removes the dialog.
  const observer = new MutationObserver(() => {
    if (viewer && (!viewer.dialog.isConnected || location.href !== viewer.url)) {
      navigating();
    }
  });
})();
