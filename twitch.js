// gtoblock — Twitch (côté extension)
// - masque les bannières pub
// - relaie au compteur les pubs zappées par le module de la page (twitch-main.js)
// - filet de sécurité : si une pub s'affiche quand même, coupe le son, cache l'image
//   et allume l'alerte « !TW » sur l'icône
// (ce script n'est chargé que si l'extension est activée)
(() => {
  const send = (m) => {
    try {
      const p = chrome.runtime.sendMessage(m);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  };

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
  const style = document.createElement("style");
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  const AD_MARKERS =
    '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]';

  function tick() {
    const video = document.querySelector("video");
    const container = video && video.closest('[data-a-target="video-player"], .video-player');
    const adOn = !!document.querySelector(AD_MARKERS);

    if (adOn && video && container) {
      if (!inAd) {
        inAd = true;
        savedMuted = video.muted;
        send({ type: "leak", site: "TW" });
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

  // Le module de la page signale chaque pub zappée
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__gtoblock === "ad") send({ type: "count" });
  });

  setInterval(tick, 300);
})();
