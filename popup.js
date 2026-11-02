const toggle = document.getElementById("toggle");
const label = document.getElementById("label");
const count = document.getElementById("count");
const leak = document.getElementById("leak");
const SITES = { TW: "Twitch", YT: "YouTube" };

chrome.storage.local.get({ enabled: true, blocked: 0, leak: null }, (r) => {
  toggle.checked = r.enabled;
  label.textContent = r.enabled ? "Activé" : "Désactivé";
  count.textContent = r.blocked;
  if (r.leak) {
    document.getElementById("leakTitle").textContent =
      "Une pub est passée sur " + (SITES[r.leak.site] || r.leak.site);
    leak.style.display = "block";
  }
});

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: toggle.checked });
  label.textContent = toggle.checked ? "Activé" : "Désactivé";
});

document.getElementById("leakOk").addEventListener("click", () => {
  chrome.storage.local.remove("leak");
  leak.style.display = "none";
});
