// gtoblock — masquage visuel des emplacements pub restants sur tous les sites
// (ce script n'est chargé que si l'extension est activée)
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
  const style = document.createElement("style");
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
})();
