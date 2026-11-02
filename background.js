// gtoblock — service worker
//
// L'extension se met à jour TOUTE SEULE : toutes les heures (et à chaque démarrage de
// Chrome) elle récupère sur GitHub les derniers scripts anti-pub, la liste des régies
// bloquées et les réglages, puis les applique. Plus jamais besoin de réinstaller.
//
// Les scripts sont exécutés via l'API « userScripts » de Chrome (celle de Tampermonkey).
// Si elle n'est pas autorisée, l'extension tourne avec ses fichiers locaux en attendant.

const REPO = "https://raw.githubusercontent.com/artercamille/gtoblock/main/";
const CHECK_EVERY_MIN = 60;

const SCRIPTS = [
  { id: "gto-content", file: "content.js", matches: ["<all_urls>"], world: "USER_SCRIPT", allFrames: true },
  { id: "gto-youtube", file: "youtube.js", matches: ["*://*.youtube.com/*"], world: "USER_SCRIPT" },
  { id: "gto-twitch-main", file: "twitch-main.js", matches: ["*://*.twitch.tv/*"], world: "MAIN" },
  { id: "gto-twitch", file: "twitch.js", matches: ["*://*.twitch.tv/*"], world: "USER_SCRIPT" },
];

// ---------- utilitaires ----------
function userScriptsOn() {
  try {
    const p = chrome.userScripts.getScripts(); // lève une erreur si non autorisé
    if (p && p.catch) p.catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

function getState() {
  return chrome.storage.local.get({
    enabled: true, config: null, rules: null, code: null,
    checkedAt: 0, updatedAt: 0, leak: null, mode: null,
  });
}

async function bundled(file) {
  return (await fetch(chrome.runtime.getURL(file))).text();
}

async function fetchText(path) {
  const r = await fetch(REPO + path + "?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(path + " : " + r.status);
  const t = await r.text();
  if (!t.trim()) throw new Error(path + " vide");
  return t;
}

// ---------- application ----------
async function registerScripts(enabled, config, code) {
  try { await chrome.scripting.unregisterContentScripts(); } catch (e) {}
  const auto = userScriptsOn();
  if (auto) {
    try { await chrome.userScripts.unregister(); } catch (e) {}
  }
  if (!enabled) return auto ? "auto" : "local";

  if (auto) {
    try { await chrome.userScripts.configureWorld({ messaging: true }); } catch (e) {}
    const list = [];
    for (const s of SCRIPTS) {
      const src = (code && code[s.file]) || (await bundled(s.file));
      list.push({
        id: s.id,
        matches: s.matches,
        allFrames: !!s.allFrames,
        runAt: "document_start",
        world: s.world,
        js: [{ code: "(function (GTO_CONFIG) {\n" + src + "\n})(" + JSON.stringify(config || {}) + ");" }],
      });
    }
    await chrome.userScripts.register(list);
    return "auto";
  }

  // Secours : fichiers locaux de l'extension
  await chrome.scripting.registerContentScripts(
    SCRIPTS.map((s) => ({
      id: s.id,
      matches: s.matches,
      allFrames: !!s.allFrames,
      runAt: "document_start",
      world: s.world === "MAIN" ? "MAIN" : "ISOLATED",
      js: [s.file],
      persistAcrossSessions: true,
    }))
  );
  return "local";
}

async function applyRules(enabled, rules) {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      enabled ? { enableRulesetIds: ["ads"] } : { disableRulesetIds: ["ads"] }
    );
  } catch (e) {}
  try {
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: old.map((r) => r.id),
      addRules: enabled && Array.isArray(rules) ? rules : [],
    });
  } catch (e) {}
}

async function refreshBadge() {
  const st = await getState();
  let text = "";
  if (!st.enabled) text = "OFF";
  else if (st.leak) text = "!" + st.leak.site;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
}

let queue = Promise.resolve();
function sync() {
  const run = async () => {
    const st = await getState();
    let mode = "erreur";
    try {
      mode = await registerScripts(st.enabled, st.config, st.code);
    } catch (e) {
      console.warn("[gtoblock] enregistrement des scripts :", e);
    }
    await applyRules(st.enabled, st.rules);
    await chrome.storage.local.set({ mode });
    await refreshBadge();
  };
  queue = queue.then(run, run);
  return queue;
}

// ---------- mise à jour depuis GitHub ----------
async function checkUpdates() {
  const st = await getState();
  try {
    const config = JSON.parse(await fetchText("config.json"));
    const rules = JSON.parse(await fetchText("rules.json"));
    if (!Array.isArray(rules)) throw new Error("rules.json invalide");
    const code = {};
    for (const s of SCRIPTS) code[s.file] = await fetchText(s.file);

    const changed =
      JSON.stringify([config, rules, code]) !== JSON.stringify([st.config, st.rules, st.code]);
    await chrome.storage.local.set(
      Object.assign({ config, rules, code, checkedAt: Date.now() }, changed ? { updatedAt: Date.now() } : {})
    );
    if (changed) await sync();
  } catch (e) {
    // GitHub injoignable : on garde la dernière version connue
    console.warn("[gtoblock] mise à jour impossible pour l'instant :", e.message);
  }
}

function start() {
  chrome.alarms.create("update", { periodInMinutes: CHECK_EVERY_MIN });
  sync().then(checkUpdates);
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "update") checkUpdates();
});

chrome.storage.onChanged.addListener((c) => {
  if (c.enabled) sync();
  else if (c.leak) refreshBadge();
});

// ---------- messages des scripts et du popup ----------
function onMessage(m, sender, reply) {
  if (!m) return;
  if (m.type === "leak") {
    chrome.storage.local.set({ leak: { site: m.site, at: Date.now() } });
  } else if (m.type === "count") {
    chrome.storage.local.get({ blocked: 0 }, (r) => chrome.storage.local.set({ blocked: r.blocked + 1 }));
  } else if (m.type === "sync") {
    sync().then(() => {
      reply(true);
      checkUpdates();
    });
    return true;
  }
}

chrome.runtime.onMessage.addListener(onMessage);
try {
  if (chrome.runtime.onUserScriptMessage) chrome.runtime.onUserScriptMessage.addListener(onMessage);
} catch (e) {}
