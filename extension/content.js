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
    const caption = element("span", {}, image.alt);
    heading.append(element("strong", {}, "Image peek"), caption);
    const sizeButton = element("button", { type: "button", disabled: "" }, "Actual size");
    const original = element("a", { href: image.url, target: "_blank", rel: "noopener noreferrer" }, "Open original image");
    toolbar.append(closeButton, heading, sizeButton, original);

    const frame = element("div", { "data-peek-gallery": "" });
    if (!multiple) frame.setAttribute("data-single", "");
    const previous = element("button", { type: "button", "data-peek-nav": "previous", "aria-label": "Previous image", title: "Previous image (←)" }, "←");
    const next = element("button", { type: "button", "data-peek-nav": "next", "aria-label": "Next image", title: "Next image (→)" }, "→");
    previous.hidden = next.hidden = !multiple;
    const stage = element("div", { "data-peek-stage": "", role: "region", tabindex: "0", "aria-label": "Image fit to window." });
    const status = element("div", { "data-peek-status": "", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    stage.append(status);
    frame.append(previous, stage, next);
    const footer = element("div", { "data-peek-footer": "" });
    const info = element("div", { "data-peek-info": "" });
    info.hidden = !multiple;
    const counter = element("div", { "data-peek-counter": "", role: "status", "aria-label": "Image position", "aria-live": "polite", "aria-atomic": "true" });
    info.append(counter, element("p", { "data-peek-scope": "" }, "Images loaded on this PR page"));
    const help = element("p", { "data-peek-help": "" });
    footer.append(info, help);
    dialog.append(toolbar, frame, footer);

    let timer;
    let closed = false;
    let picture;
    let loadState;

    function close({ navigating = false } = {}) {
      if (closed) return;
      closed = true;
      observer.disconnect();
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
        close();
      } else if (event.key === "Tab") {
        const stops = [...dialog.querySelectorAll('button:not(:disabled), a[href], [data-peek-stage]')]
          .filter((node) => !node.hidden);
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
      } else if (multiple && dialog.dataset.size === "fit" &&
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
          ? "Try “Open original image”, use the arrows to continue, or press Escape."
          : "Try “Open original image”, or press Escape to return to the pull request.";
      } else if (dialog.dataset.size === "actual") {
        help.textContent = multiple
          ? "Arrow keys to scroll · Use screen arrows to browse · Escape to close"
          : "Arrow keys to scroll · Fit to window to see the whole image";
      } else {
        help.textContent = multiple
          ? "← → to browse · Escape to close"
          : "Escape to close · Actual size to inspect details";
      }
    }

    function loadImage() {
      const focused = document.activeElement;
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
      original.href = current.url;
      counter.textContent = `${index + 1} of ${gallery.images.length}`;
      previous.disabled = index === 0;
      next.disabled = index === gallery.images.length - 1;
      dialog.dataset.size = "fit";
      sizeButton.textContent = "Actual size";
      sizeButton.disabled = true;
      stage.setAttribute("aria-label", "Image fit to window.");
      stage.setAttribute("aria-busy", "true");
      status.textContent = "Loading image…";
      loadState = status.dataset.state = "loading";
      updateHelp();
      stage.scrollTo({ left: 0, top: 0, behavior: "instant" });

      if ([previous, next, sizeButton].some((button) => button === focused && button.disabled)) {
        stage.focus({ preventScroll: true });
      }

      function failed() {
        if (closed || picture !== loading) return;
        clearTimeout(timer);
        loading.onload = loading.onerror = null;
        loading.hidden = true;
        status.textContent = "This image could not be loaded.";
        loadState = status.dataset.state = "error";
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
        sizeButton.disabled = false;
        stage.setAttribute("aria-busy", "false");
        updateHelp();
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
    sizeButton.addEventListener("click", () => {
      const actual = dialog.dataset.size !== "actual";
      dialog.dataset.size = actual ? "actual" : "fit";
      sizeButton.textContent = actual ? "Fit to window" : "Actual size";
      stage.setAttribute("aria-label", actual ? "Image at actual size. Use arrow keys to scroll." : "Image fit to window.");
      stage.scrollTo(0, 0);
      updateHelp();
      stage.focus({ preventScroll: true });
    });
    closeButton.addEventListener("click", () => close());
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("close", () => close());
    // Require both ends of the pointer gesture on empty space so a drag that
    // starts on the image and ends on the backdrop does not dismiss the viewer.
    let backdropStart = false;
    let suppressSwipeClick = false;
    let swipe = null;
    const pointers = new Set();
    dialog.addEventListener("pointerdown", (event) => {
      suppressSwipeClick = false;
      backdropStart = event.target === stage || event.target === dialog;
      if (!["touch", "pen"].includes(event.pointerType)) return;
      pointers.add(event.pointerId);
      if (!multiple || dialog.dataset.size !== "fit" || pointers.size !== 1 ||
          !event.isPrimary || event.button !== 0 || !stage.contains(event.target)) {
        swipe = null;
        return;
      }
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
      // Capture lets a swipe finish outside the image area. Synthetic events in
      // tests or canceled pointers may not have an active pointer to capture.
      try { stage.setPointerCapture(event.pointerId); } catch { /* No active pointer. */ }
    });
    dialog.addEventListener("pointermove", (event) => {
      if (swipe?.id === event.pointerId &&
          Math.hypot(event.clientX - swipe.x, event.clientY - swipe.y) > 8) backdropStart = false;
    });
    dialog.addEventListener("pointerup", (event) => {
      pointers.delete(event.pointerId);
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
      pointers.delete(event.pointerId);
      swipe = null;
      backdropStart = false;
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
