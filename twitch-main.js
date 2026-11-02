// gtoblock — Twitch : skip réel des pubs (tourne dans la page, "MAIN world").
//
// Twitch incruste ses pubs DANS le flux vidéo (playlists HLS). On injecte du code dans le
// worker du lecteur : quand une playlist contient une pub, on la remplace par la même qualité
// récupérée avec un autre type de lecteur (embed, popout, autoplay…) qui n'a pas de pub.
// En dernier recours, on retire les segments pub.
//
// Les réglages sensibles viennent de config.json (GitHub), modifiables sans réinstaller.
(() => {
  let CFG = {};
  try {
    if (localStorage.getItem("gtoblock_off") === "1") return;
    CFG = (JSON.parse(localStorage.getItem("gtoblock_cfg") || "{}") || {}).twitch || {};
  } catch (e) {}
  const FORCE_TYPE = typeof CFG.forcePlayerType === "string" ? CFG.forcePlayerType : "popout";

  const LOG = (...a) => console.log("%c[gtoblock]", "color:#7c5cff;font-weight:bold", ...a);

  // ====================== code injecté DANS le worker du lecteur ======================
  function workerHook(cfg) {
    const realFetch = self.fetch.bind(self);
    const AD = cfg.adMarker || "stitched";
    const BACKUP_TYPES =
      Array.isArray(cfg.backupTypes) && cfg.backupTypes.length
        ? cfg.backupTypes
        : ["embed", "popout", "autoplay", "picture-by-picture"];
    const byUrl = {}; // URL playlist d'une qualité -> { info, cur }
    const pending = new Map();
    const log = (msg) => postMessage({ key: "AB_Log", value: msg });

    self.addEventListener("message", (e) => {
      const d = e.data;
      if (d && d.key === "AB_FetchResponse" && pending.has(d.id)) {
        const done = pending.get(d.id);
        pending.delete(d.id);
        done(d);
      }
    });

    // La requête GQL passe par la page (qui a les bons en-têtes Twitch)
    function gql(body) {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        pending.set(id, resolve);
        postMessage({ key: "AB_Fetch", id, body: JSON.stringify(body) });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            resolve({ status: 0, text: "" });
          }
        }, 5000);
      });
    }

    async function getToken(channel, playerType) {
      const r = await gql({
        operationName: "PlaybackAccessToken_Template",
        query:
          'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }',
        variables: {
          isLive: true,
          login: channel,
          isVod: false,
          vodID: "",
          playerType,
          platform: playerType === "autoplay" ? "android" : "web",
        },
      });
      if (r.status !== 200) return null;
      try {
        return JSON.parse(r.text).data.streamPlaybackAccessToken || null;
      } catch (e) {
        return null;
      }
    }

    function parseVariants(text) {
      const lines = text.replace(/\r/g, "").split("\n");
      const out = [];
      for (let i = 0; i < lines.length - 1; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
        const url = lines[i + 1].trim();
        if (!url.includes(".m3u8")) continue;
        const res = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
        const fps = lines[i].match(/FRAME-RATE=([\d.]+)/);
        out.push({
          url,
          res: res ? res[1] + "x" + res[2] : "",
          h: res ? +res[2] : 0,
          fps: fps ? Math.round(+fps[1]) : 0,
        });
      }
      return out;
    }

    function pickUrl(master, cur) {
      const vs = parseVariants(master);
      if (!vs.length) return null;
      const same =
        vs.find((v) => v.res === cur.res && v.fps === cur.fps) || vs.find((v) => v.res === cur.res);
      if (same) return same.url;
      const sized = vs.filter((v) => v.h);
      if (!sized.length) return vs[0].url;
      sized.sort((a, b) => Math.abs(a.h - cur.h) - Math.abs(b.h - cur.h));
      return sized[0].url;
    }

    async function backupPlaylist(info, cur) {
      for (const type of BACKUP_TYPES) {
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            let master = info.cache[type];
            const fresh = !master;
            if (!master) {
              const t = await getToken(info.channel, type);
              if (!t) break;
              const u = new URL("https://usher.ttvnw.net" + info.path + info.search);
              u.searchParams.set("sig", t.signature);
              u.searchParams.set("token", t.value);
              u.searchParams.delete("parent_domains");
              u.searchParams.set("p", String(Math.floor(Math.random() * 1e7)));
              const r = await realFetch(u.href);
              if (r.status !== 200) break;
              master = info.cache[type] = await r.text();
            }
            const url = pickUrl(master, cur);
            if (!url) break;
            const r = await realFetch(url);
            if (r.status === 200) {
              const text = await r.text();
              if (text && !text.includes(AD)) return { type, text };
            }
            info.cache[type] = null; // jeton périmé ou flux avec pub
            if (fresh) break;
          }
        } catch (e) {}
      }
      return null;
    }

    // Dernier recours : on retire les segments pub (image figée quelques secondes, zéro pub)
    function strip(text) {
      const lines = text.replace(/\r/g, "").split("\n");
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.startsWith("#EXTINF") && !l.includes(",live")) {
          i++;
          continue;
        }
        if (l.startsWith("#EXT-X-DATERANGE") && l.includes(AD)) continue;
        if (l.startsWith("#EXT-X-TWITCH-PREFETCH")) continue;
        out.push(l);
      }
      return out.join("\n");
    }

    self.fetch = async function (input, init) {
      const url = (typeof input === "string" ? input : (input && input.url) || "").trimEnd();

      // Playlist principale d'une chaîne : on mémorise les qualités disponibles
      if (url.includes("/channel/hls/") && !url.includes("picture-by-picture")) {
        const u = new URL(url);
        u.searchParams.delete("parent_domains");
        const m = u.pathname.match(/([^/]+)\.m3u8$/);
        const resp = await realFetch(u.href, init);
        if (!m || resp.status !== 200) return resp;
        const text = await resp.text();
        const info = { channel: m[1].toLowerCase(), path: u.pathname, search: u.search, cache: {}, inAd: false, mode: null };
        parseVariants(text).forEach((v) => (byUrl[v.url] = { info, cur: v }));
        return new Response(text, { status: 200, headers: resp.headers });
      }

      // Playlist d'une qualité : c'est là que Twitch glisse les pubs
      const entry = byUrl[url];
      if (entry) {
        const resp = await realFetch(input, init);
        if (resp.status !== 200) return resp;
        let text = await resp.text();
        const { info, cur } = entry;

        if (text.includes(AD)) {
          if (!info.inAd) {
            info.inAd = true;
            postMessage({ key: "AB_Ad", value: true });
          }
          const b = await backupPlaylist(info, cur);
          if (b) {
            if (info.mode !== b.type) log("Pub remplacée par le flux « " + b.type + " »");
            info.mode = b.type;
            text = b.text;
          } else {
            if (info.mode !== "strip") log("Aucun flux sans pub dispo : segments pub retirés");
            info.mode = "strip";
            text = strip(text);
          }
        } else if (info.inAd) {
          info.inAd = false;
          info.mode = null;
          info.cache = {};
          postMessage({ key: "AB_Ad", value: false });
          log("Fin de la coupure pub");
        }
        return new Response(text, { status: 200, headers: resp.headers });
      }

      return realFetch(input, init);
    };
  }
  // ====================================================================================

  const HOOK = "(" + workerHook.toString() + ")(" + JSON.stringify(CFG) + ");\n";
  const realFetch = window.fetch.bind(window);
  const gqlHeaders = {};
  let deviceId = null;

  // 1) On capte les en-têtes GQL de Twitch (intégrité, auth, device…) pour que nos
  //    requêtes de secours soient acceptées. Et on demande le flux principal en
  //    mode "popout", qui a souvent moins (voire pas) de pubs.
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("gql.twitch.tv/gql") && init) {
        if (init.headers) {
          const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
          for (const k of Object.keys(h)) {
            const lk = k.toLowerCase();
            if (lk === "x-device-id" || lk === "device-id") deviceId = h[k];
            else if (["client-integrity", "authorization", "client-version", "client-session-id"].includes(lk))
              gqlHeaders[lk] = h[k];
          }
        }
        if (typeof init.body === "string" && init.body.includes("PlaybackAccessToken")) {
          const b = JSON.parse(init.body);
          const swap = (o) => {
            if (FORCE_TYPE && o && o.variables && o.variables.playerType === "site") o.variables.playerType = FORCE_TYPE;
          };
          Array.isArray(b) ? b.forEach(swap) : swap(b);
          init = Object.assign({}, init, { body: JSON.stringify(b) });
        }
      }
    } catch (e) {}
    return realFetch(input, init);
  };

  function headersForGql() {
    if (!deviceId) {
      const c = "abcdefghijklmnopqrstuvwxyz0123456789";
      deviceId = Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join("");
    }
    const h = { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Device-ID": deviceId };
    if (gqlHeaders["client-integrity"]) h["Client-Integrity"] = gqlHeaders["client-integrity"];
    if (gqlHeaders["authorization"]) h["Authorization"] = gqlHeaders["authorization"];
    if (gqlHeaders["client-version"]) h["Client-Version"] = gqlHeaders["client-version"];
    if (gqlHeaders["client-session-id"]) h["Client-Session-Id"] = gqlHeaders["client-session-id"];
    return h;
  }

  async function relay(worker, d) {
    try {
      const r = await realFetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: headersForGql(),
        body: d.body,
      });
      worker.postMessage({ key: "AB_FetchResponse", id: d.id, status: r.status, text: await r.text() });
    } catch (e) {
      worker.postMessage({ key: "AB_FetchResponse", id: d.id, status: 0, text: "" });
    }
  }

  // Petit badge visible pendant qu'une pub est zappée (preuve que ça marche)
  let badge = null;
  function showBadge(on) {
    if (on) {
      window.postMessage({ __gtoblock: "ad" }, "*");
      if (!badge) {
        badge = document.createElement("div");
        badge.textContent = "🛡️ gtoblock : pub zappée, le live continue";
        badge.style.cssText =
          "position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#7c5cff;color:#fff;" +
          "font:600 13px system-ui,sans-serif;padding:8px 14px;border-radius:999px;" +
          "box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none";
      }
      (document.body || document.documentElement).appendChild(badge);
    } else if (badge) {
      badge.remove();
    }
  }

  // 2) On remplace le constructeur Worker pour injecter notre code dans le lecteur.
  //    Le code du worker Twitch est lu tout de suite (Twitch révoque son URL blob juste après).
  function readSync(url) {
    const x = new XMLHttpRequest();
    x.open("GET", url, false);
    x.overrideMimeType("text/javascript");
    x.send();
    return x.responseText;
  }

  const RealWorker = window.Worker;

  class GtoWorker extends RealWorker {
    constructor(url, options) {
      let finalUrl = url;
      let hooked = false;
      try {
        const abs = new URL(String(url), location.href);
        if (abs.origin.endsWith("twitch.tv")) {
          const body =
            abs.protocol === "blob:" ? readSync(abs.href) : "importScripts(" + JSON.stringify(abs.href) + ");";
          finalUrl = URL.createObjectURL(new Blob([HOOK + body], { type: "text/javascript" }));
          hooked = true;
        }
      } catch (e) {
        finalUrl = url;
      }
      super(finalUrl, options);
      if (!hooked) return;
      LOG("Lecteur Twitch protégé");
      this.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.key !== "string" || !d.key.startsWith("AB_")) return;
        e.stopImmediatePropagation();
        if (d.key === "AB_Fetch") relay(this, d);
        else if (d.key === "AB_Log") LOG(d.value);
        else if (d.key === "AB_Ad") showBadge(d.value);
      });
    }
  }

  // 3) On empêche Twitch de remettre le Worker d'origine
  let current = GtoWorker;
  Object.defineProperty(window, "Worker", {
    configurable: true,
    get: () => current,
    set: (v) => {
      if (v && v.prototype instanceof GtoWorker) current = v;
    },
  });

  LOG("Module Twitch actif");
})();
