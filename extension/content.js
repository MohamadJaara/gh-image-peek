(() => {
  "use strict";

  // One delegated listener survives GitHub's Turbo/PJAX navigation and lazy loading.
  const prPath = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/;
  const imageExtension = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
  const imageScope = '.markdown-body, .js-file-content, .file .data, .image-diff, [data-testid="image-diff"]';
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

  function openViewer(image) {
    if (viewer || !document.body) return;

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
    heading.append(element("strong", {}, "Image peek"), element("span", {}, image.alt));
    const sizeButton = element("button", { type: "button", disabled: "" }, "Actual size");
    const original = element("a", { href: image.url, target: "_blank", rel: "noopener noreferrer" }, "Open original image");
    toolbar.append(closeButton, heading, sizeButton, original);

    const stage = element("div", { "data-peek-stage": "", role: "region", tabindex: "0", "aria-label": "Image fit to window." });
    const status = element("div", { "data-peek-status": "", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const picture = element("img", { "data-peek-image": "", alt: image.alt, hidden: "" });
    stage.append(status, picture);
    const help = element("p", { "data-peek-help": "" }, "Escape to close · Actual size to inspect details");
    dialog.append(toolbar, stage, help);

    let timer;
    let closed = false;

    function close({ navigating = false } = {}) {
      if (closed) return;
      closed = true;
      observer.disconnect();
      clearTimeout(timer);
      picture.onload = null;
      picture.onerror = null;
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
        const stops = [closeButton, ...(!sizeButton.disabled ? [sizeButton] : []), original, stage];
        const index = stops.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          stops.at(-1).focus();
        } else if (!event.shiftKey && (index === -1 || index === stops.length - 1)) {
          event.preventDefault();
          closeButton.focus();
        }
        // Do not let GitHub's single-key shortcuts act on the page behind us.
        event.stopPropagation();
      } else {
        event.stopPropagation();
      }
    }

    function failed() {
      if (closed) return;
      clearTimeout(timer);
      picture.onload = null;
      picture.onerror = null;
      picture.hidden = true;
      status.textContent = "This image could not be loaded.";
      status.dataset.state = "error";
      help.textContent = "Try “Open original image”, or press Escape to return to the pull request.";
      stage.setAttribute("aria-busy", "false");
    }

    picture.onload = () => {
      if (closed) return;
      if (!picture.naturalWidth || !picture.naturalHeight) {
        failed();
        return;
      }
      clearTimeout(timer);
      picture.hidden = false;
      status.textContent = `${picture.naturalWidth.toLocaleString()} × ${picture.naturalHeight.toLocaleString()} pixels`;
      status.dataset.state = "ready";
      sizeButton.disabled = false;
      stage.setAttribute("aria-busy", "false");
    };
    picture.onerror = failed;
    sizeButton.addEventListener("click", () => {
      const actual = dialog.dataset.size !== "actual";
      dialog.dataset.size = actual ? "actual" : "fit";
      sizeButton.textContent = actual ? "Fit to window" : "Actual size";
      stage.setAttribute("aria-label", actual ? "Image at actual size. Use arrow keys to scroll." : "Image fit to window.");
      stage.scrollTo(0, 0);
      help.textContent = actual ? "Arrow keys to scroll · Fit to window to see the whole image" : "Escape to close · Actual size to inspect details";
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
    dialog.addEventListener("pointerdown", (event) => {
      backdropStart = event.target === stage || event.target === dialog;
    });
    dialog.addEventListener("click", (event) => {
      if (backdropStart && (event.target === stage || event.target === dialog)) close();
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
    stage.setAttribute("aria-busy", "true");
    status.textContent = "Loading image…";
    status.dataset.state = "loading";
    timer = window.setTimeout(failed, 30000);
    picture.src = image.url;
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
