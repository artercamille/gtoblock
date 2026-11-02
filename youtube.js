// gtoblock — YouTube : saute les pubs vidéo, masque les pubs du fil et le popup anti-bloqueur
// (ce script n'est chargé que si l'extension est activée)
(() => {
  const send = (m) => {
    try {
      const p = chrome.runtime.sendMessage(m);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  };

  let inAd = false;
  let saved = { muted: false, rate: 1 };
  let lastAdSrc = null;
  let adSince = 0;
  let leakSent = false;

  const CSS = `
    #masthead-ad, #player-ads, ad-slot-renderer,
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
    ytd-banner-promo-renderer, ytd-statement-banner-renderer,
    ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
    ytd-display-ad-renderer, ytd-companion-slot-renderer,
    ytd-action-companion-ad-renderer, ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-merch-shelf-renderer, ytd-search-pyv-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    .ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-ad-text-overlay,
    ytm-promoted-sparkles-web-renderer, ytm-companion-ad-renderer,
    ytd-enforcement-message-view-model
    { display: none !important; }
  `;

  const SKIP_BUTTONS =
    ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button";

  const style = document.createElement("style");
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  function tick() {
    const player = document.querySelector("#movie_player, #player");
    const video = player && player.querySelector("video");

    if (player && video && player.classList.contains("ad-showing")) {
      if (!inAd) {
        inAd = true;
        adSince = Date.now();
        saved = { muted: video.muted, rate: 1 };
      }
      // Pub toujours là après 8 s malgré le skip : YouTube a changé quelque chose
      if (!leakSent && Date.now() - adSince > 8000) {
        leakSent = true;
        send({ type: "leak", site: "YT" });
      }
      document.querySelectorAll(SKIP_BUTTONS).forEach((b) => b.click());
      video.muted = true;
      video.playbackRate = 16;
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(0, video.duration - 0.1);
      }
      if (video.src && video.src !== lastAdSrc) {
        lastAdSrc = video.src;
        send({ type: "count" });
      }
    } else if (inAd && video) {
      inAd = false;
      leakSent = false;
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
    }

    // Popup « Les bloqueurs de pubs ne sont pas autorisés »
    const wall = document.querySelector("ytd-enforcement-message-view-model");
    if (wall) {
      const dialog = wall.closest("tp-yt-paper-dialog");
      if (dialog) dialog.remove();
      document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((b) => b.remove());
      if (document.body) document.body.style.overflow = "";
      if (video && video.paused) video.play().catch(() => {});
    }
  }

  setInterval(tick, 250);
})();
