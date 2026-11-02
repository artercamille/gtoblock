// Masquage visuel des emplacements pub restants sur tous les sites
(() => {
  const CSS = `
    ins.adsbygoogle, .adsbygoogle,
    [id^="google_ads_"], [id^="div-gpt-ad"], [id^="gpt-ad"],
    iframe[id^="google_ads_iframe"], iframe[src*="doubleclick.net"],
    iframe[src*="googlesyndication.com"], iframe[src*="amazon-adsystem.com"],
    [data-ad-slot], [data-google-query-id], [data-ad-unit], [data-adunit],
    [id^="taboola-"], .trc_related_container, .taboola,
    .OUTBRAIN, [data-widget-id^="outbrain"], .ob-widget,
    .ad-banner, .ad-container, .ad-slot, .ad-wrapper, .ad-unit,
    .advertisement, .advertising, .sponsored-ad, #ad-banner, #ad-container
    { display: none !important; }
  `;
  let style = null;

  function apply(enabled) {
    if (enabled && !style) {
      style = document.createElement("style");
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    } else if (!enabled && style) {
      style.remove();
      style = null;
    }
  }

  chrome.storage.local.get({ enabled: true }, (r) => apply(r.enabled));
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled) apply(c.enabled.newValue);
  });
})();
