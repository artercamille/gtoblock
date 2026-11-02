// gtoblock — service worker
// - active / désactive les règles réseau
// - récupère les réglages à distance (config.json sur GitHub)
// - affiche une alerte sur l'icône si une pub passe malgré tout

const CONFIG_URL = "https://raw.githubusercontent.com/artercamille/gtoblock/main/config.json";

function refreshBadge() {
  chrome.storage.local.get({ enabled: true, leak: null }, (r) => {
    let text = "";
    if (!r.enabled) text = "OFF";
    else if (r.leak) text = "!" + r.leak.site;
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  });
}

function syncRules(enabled) {
  chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: ["ads"] } : { disableRulesetIds: ["ads"] }
  );
  refreshBadge();
}

async function refreshConfig() {
  try {
    const r = await fetch(CONFIG_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) chrome.storage.local.set({ config: await r.json() });
  } catch (e) {}
}

function init() {
  chrome.storage.local.get({ enabled: true }, (r) => syncRules(r.enabled));
  refreshConfig();
  chrome.alarms.create("config", { periodInMinutes: 360 });
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "config") refreshConfig();
});

chrome.storage.onChanged.addListener((c) => {
  if (c.enabled) syncRules(c.enabled.newValue);
  else if (c.leak) refreshBadge();
});

// Une pub est passée : le site a probablement changé quelque chose
chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === "leak") chrome.storage.local.set({ leak: { site: m.site, at: Date.now() } });
});
