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
  let hidden = false; // pub laissée passer volontairement (aucun flux sans pub) : on la cache
  let adEndsAt = 0; // heure de fin estimée de la pub (pour le compte à rebours)

  const CSS = `
    [data-a-target="ads-banner"], [data-test-selector="ad-banner-default-text"],
    .stream-display-ad__wrapper, .stream-display-ad__container,
    .tw-tower > [class*="ad-"], [class*="display-ad"], [class*="DisplayAd"]
    { display: none !important; }
    .gtoblock-cover {
      position: absolute; inset: 0; z-index: 9999;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      background: #000; color: #efeff1; font-family: system-ui, sans-serif;
      pointer-events: none;
    }
    .gtoblock-cover b { font-size: 26px; font-weight: 700; letter-spacing: .5px; }
    .gtoblock-cover span { font-size: 44px; font-weight: 300; font-variant-numeric: tabular-nums; color: #bf94ff; }
    .gtoblock-cover span:empty { display: none; }
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  const AD_MARKERS =
    '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]';

  function tick() {
    const video = document.querySelector("video");
    const container = video && video.closest('[data-a-target="video-player"], .video-player');
    const adOn = hidden || !!document.querySelector(AD_MARKERS);

    if (adOn && video && container) {
      if (!inAd) {
        inAd = true;
        savedMuted = video.muted;
        // Alerte seulement si la pub passe sans qu'on l'ait prévu
        if (!hidden) send({ type: "leak", site: "TW" });
      }
      video.muted = true;
      if (!cover) {
        cover = document.createElement("div");
        cover.className = "gtoblock-cover";
        cover.innerHTML = "<b>Pub en cours</b><span></span>";
        container.style.position = container.style.position || "relative";
        container.appendChild(cover);
      }
      cover.querySelector("span").textContent = timerText();
    } else if (inAd) {
      inAd = false;
      if (video) video.muted = savedMuted;
      if (cover) cover.remove();
      cover = null;
      adEndsAt = 0;
    }
  }

  // Compte à rebours : celui de Twitch s'il est affiché, sinon notre estimation
  function timerText() {
    const tw = document.querySelector('[data-a-target="video-ad-countdown"]');
    const m = tw && tw.textContent.match(/(\d+):(\d{2})/);
    let sec = m ? +m[1] * 60 + +m[2] : adEndsAt ? Math.ceil((adEndsAt - Date.now()) / 1000) : null;
    if (sec == null) return "";
    sec = Math.max(0, sec);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  // Le module de la page signale chaque pub zappée
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__gtoblock === "ad") send({ type: "count" });
    if (e.data.__gtoblock === "hide") {
      hidden = !!e.data.on;
      if (!hidden) adEndsAt = 0;
      else if (typeof e.data.remaining === "number") {
        const est = Date.now() + e.data.remaining * 1000;
        // on ne fait remonter le timer que si la pub s'est rallongée (plusieurs pubs à la suite)
        if (!adEndsAt || est > adEndsAt + 3000 || est < adEndsAt - 10000) adEndsAt = est;
      }
      tick();
    }
  });

  setInterval(tick, 300);
})();
