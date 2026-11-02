// gtoblock — Twitch (côté extension)
// - masque les bannières pub
// - filet de sécurité : si une pub s'affiche quand même, coupe le son, cache l'image
//   et allume l'alerte « !TW » sur l'icône
// - transmet l'état ON/OFF et les réglages à distance au module de la page
(() => {
  let enabled = true;
  let style = null;
  let inAd = false;
  let savedMuted = false;
  let cover = null;

  const CSS = `
    [data-a-target="ads-banner"], [data-test-selector="ad-banner-default-text"],
    .stream-display-ad__wrapper, .stream-display-ad__container,
    .tw-tower > [class*="ad-"], [class*="display-ad"], [class*="DisplayAd"]
    { display: none !important; }
    .gtoblock-cover {
      position: absolute; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: #0e0e10; color: #efeff1; font: 600 16px system-ui, sans-serif;
      pointer-events: none;
    }
  `;

  const AD_MARKERS =
    '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]';

  function applyCss() {
    if (enabled && !style) {
      style = document.createElement("style");
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    } else if (!enabled && style) {
      style.remove();
      style = null;
    }
  }

  function tick() {
    const video = document.querySelector("video");
    const container = video && video.closest('[data-a-target="video-player"], .video-player');
    const adOn = enabled && !!document.querySelector(AD_MARKERS);

    if (adOn && video && container) {
      if (!inAd) {
        inAd = true;
        savedMuted = video.muted;
        chrome.runtime.sendMessage({ type: "leak", site: "TW" }).catch(() => {});
      }
      video.muted = true;
      if (!cover) {
        cover = document.createElement("div");
        cover.className = "gtoblock-cover";
        cover.textContent = "Pub coupée par gtoblock — le live revient tout de suite";
        container.style.position = container.style.position || "relative";
        container.appendChild(cover);
      }
    } else if (inAd) {
      inAd = false;
      if (video) video.muted = savedMuted;
      if (cover) cover.remove();
      cover = null;
    }
  }

  // Le module de la page lit ces valeurs au chargement suivant
  function share(config) {
    try {
      localStorage.setItem("gtoblock_off", enabled ? "0" : "1");
      if (config) localStorage.setItem("gtoblock_cfg", JSON.stringify(config));
    } catch (e) {}
  }

  chrome.storage.local.get({ enabled: true, config: null }, (r) => {
    enabled = r.enabled;
    applyCss();
    share(r.config);
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled) {
      enabled = c.enabled.newValue;
      applyCss();
    }
    if (c.enabled || c.config) share(c.config ? c.config.newValue : null);
  });

  // Compteur : le module de la page signale chaque pub zappée
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__gtoblock === "ad") {
      chrome.storage.local.get({ blocked: 0 }, (r) =>
        chrome.storage.local.set({ blocked: r.blocked + 1 })
      );
    }
  });

  setInterval(tick, 300);
})();
