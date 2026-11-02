const $ = (id) => document.getElementById(id);
const SITES = { TW: "Twitch", YT: "YouTube" };

function hhmm(t) {
  return new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function render() {
  chrome.storage.local.get({ enabled: true, blocked: 0, leak: null, mode: null, checkedAt: 0 }, (r) => {
    $("toggle").checked = r.enabled;
    $("label").textContent = r.enabled ? "Activé" : "Désactivé";
    $("count").textContent = r.blocked;

    $("leak").style.display = r.leak ? "block" : "none";
    if (r.leak) $("leakTitle").textContent = "Une pub est passée sur " + (SITES[r.leak.site] || r.leak.site);

    $("setup").style.display = r.mode === "local" ? "block" : "none";

    const status = $("status");
    if (r.mode === "auto") {
      status.className = "status ok";
      status.textContent = "✓ Mises à jour automatiques" + (r.checkedAt ? " · vérifié à " + hhmm(r.checkedAt) : "");
    } else {
      status.className = "status";
      status.textContent = "Recharge la page après avoir changé l'état.";
    }
  });
}

render();
// À chaque ouverture : on réapplique et on cherche une mise à jour
chrome.runtime.sendMessage({ type: "sync" }).then(render).catch(() => {});

$("toggle").addEventListener("change", () => {
  chrome.storage.local.set({ enabled: $("toggle").checked });
  $("label").textContent = $("toggle").checked ? "Activé" : "Désactivé";
});

$("leakOk").addEventListener("click", () => {
  chrome.storage.local.remove("leak");
  $("leak").style.display = "none";
});

$("setupBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
});
