// gtoblock — Twitch : skip réel des pubs (tourne dans la page, "MAIN world").
//
// Twitch incruste ses pubs DANS le flux vidéo (playlists HLS). On injecte du code dans le
// worker du lecteur : quand une playlist contient une pub, on la remplace par la même qualité
// récupérée avec un autre type de lecteur (popout, embed, android…) qui n'a pas de pub.
// Ces flux de secours sont demandés en ANONYME (sans le compte), car Twitch met beaucoup
// plus de pubs aux comptes connectés. Ils sont testés en parallèle pour aller vite.
// Les flux basse qualité (360p) ne servent qu'en tout dernier recours.
//
// Les réglages sensibles viennent de config.json (GitHub) via GTO_CONFIG, fourni par l'extension.
// (ce script n'est chargé que si l'extension est activée)
(() => {
  const CFG = (typeof GTO_CONFIG !== "undefined" && GTO_CONFIG && GTO_CONFIG.twitch) || {};
  const FORCE_TYPE = typeof CFG.forcePlayerType === "string" ? CFG.forcePlayerType : "popout";
  const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

  const LOG = (...a) => console.log("%c[gtoblock]", "color:#7c5cff;font-weight:bold", ...a);

  // ====================== code injecté DANS le worker du lecteur ======================
  function workerHook(cfg) {
    const realFetch = self.fetch.bind(self);
    const AD = cfg.adMarker || "stitched";
    const toCombo = (s) => {
      const [type, platform] = String(s).split("/");
      return { key: String(s), type, platform: platform || (type === "autoplay" ? "android" : "web") };
    };
    const HD = (Array.isArray(cfg.backupPlayers) && cfg.backupPlayers.length
      ? cfg.backupPlayers
      : ["popout", "site", "embed", "frontpage", "dashboard", "site/android", "popout/android", "embed/android", "site/ios"]
    ).map(toCombo);
    const LOW = (Array.isArray(cfg.lowResPlayers) ? cfg.lowResPlayers : ["autoplay", "picture-by-picture"]).map(toCombo);
    const ANON = cfg.backupAnonymous !== false;
    const TIMEOUT = cfg.backupTimeoutMs || 4000;

    const byUrl = {}; // URL playlist d'une qualité -> { info, cur }
    const pending = new Map();
    const log = (msg) => postMessage({ key: "AB_Log", value: msg });
    const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

    self.addEventListener("message", (e) => {
      const d = e.data;
      if (d && d.key === "AB_FetchResponse" && pending.has(d.id)) {
        const done = pending.get(d.id);
        pending.delete(d.id);
        done(d);
      }
    });

    // La requête GQL passe par la page
    function gql(body) {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        pending.set(id, resolve);
        postMessage({ key: "AB_Fetch", id, anon: ANON, body: JSON.stringify(body) });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            resolve({ status: 0, text: "" });
          }
        }, TIMEOUT);
      });
    }

    async function getToken(channel, combo) {
      const r = await gql({
        operationName: "PlaybackAccessToken_Template",
        query:
          'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }',
        variables: { isLive: true, login: channel, isVod: false, vodID: "", playerType: combo.type, platform: combo.platform },
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

    function pickVariant(master, cur) {
      const vs = parseVariants(master);
      if (!vs.length) return null;
      const same =
        vs.find((v) => v.res === cur.res && v.fps === cur.fps) || vs.find((v) => v.res === cur.res);
      if (same) return same;
      const sized = vs.filter((v) => v.h);
      if (!sized.length) return vs[0];
      sized.sort((a, b) => Math.abs(a.h - cur.h) - Math.abs(b.h - cur.h));
      return sized[0];
    }

    // Essaie un type de lecteur : renvoie sa playlist s'il n'a pas de pub
    async function tryCombo(info, combo, cur) {
      let master = info.cache[combo.key];
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = !master;
        if (!master) {
          const t = await getToken(info.channel, combo);
          if (!t) return null;
          const u = new URL("https://usher.ttvnw.net" + info.path + info.search);
          u.searchParams.set("sig", t.signature);
          u.searchParams.set("token", t.value);
          u.searchParams.delete("parent_domains");
          u.searchParams.set("p", String(Math.floor(Math.random() * 1e7)));
          const r = await realFetch(u.href);
          if (r.status !== 200) return null;
          master = info.cache[combo.key] = await r.text();
        }
        const v = pickVariant(master, cur);
        if (!v) return null;
        const r = await realFetch(v.url);
        if (r.status === 200) {
          const text = await r.text();
          if (text && !text.includes(AD)) return { combo, text, h: v.h };
        }
        info.cache[combo.key] = master = null; // jeton périmé ou flux avec pub
        if (fresh) return null;
      }
      return null;
    }

    // Teste plusieurs types en parallèle, garde le meilleur : même qualité d'abord
    async function search(info, cur, combos) {
      const results = await Promise.all(
        combos.map((c) => withTimeout(tryCombo(info, c, cur).catch(() => null), TIMEOUT))
      );
      let best = null;
      let bestRank = Infinity;
      results.forEach((r, i) => {
        if (!r) return;
        const rank = (r.h >= cur.h ? 0 : 10000 - r.h) * 100 + i;
        if (rank < bestRank) {
          best = r;
          bestRank = rank;
        }
      });
      return best;
    }

    async function backupPlaylist(info, cur) {
      // Le dernier secours qui marchait : une seule requête
      if (info.good) {
        const goodIsHd = info.goodH >= cur.h;
        const retryHd = !goodIsHd && Date.now() - info.lastSearch > 8000;
        if (!retryHd) {
          const r = await withTimeout(tryCombo(info, info.good, cur).catch(() => null), TIMEOUT);
          if (r) return r;
        }
        info.good = null;
      }
      info.lastSearch = Date.now();
      let best = await search(info, cur, HD);
      if (!best) best = await search(info, cur, LOW);
      if (best) {
        info.good = best.combo;
        info.goodH = best.h;
      }
      return best;
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
        const info = {
          channel: m[1].toLowerCase(), path: u.pathname, search: u.search,
          cache: {}, inAd: false, mode: null, good: null, goodH: 0, lastSearch: 0, lowRes: false,
        };
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
            info.lowRes = false;
            postMessage({ key: "AB_Ad", value: true });
          }
          const b = await backupPlaylist(info, cur);
          if (b) {
            const label = b.combo.key + " " + (b.h ? b.h + "p" : "");
            if (info.mode !== label) log("Pub remplacée par le flux « " + label + " »");
            info.mode = label;
            if (b.h && cur.h && b.h < cur.h) info.lowRes = true;
            text = b.text;
          } else {
            if (info.mode !== "strip") log("Aucun flux sans pub dispo : segments pub retirés");
            info.mode = "strip";
            info.lowRes = true;
            text = strip(text);
          }
        } else if (info.inAd) {
          info.inAd = false;
          info.mode = null;
          info.good = null;
          info.cache = {};
          postMessage({ key: "AB_Ad", value: false, nudge: info.lowRes });
          log("Fin de la coupure pub" + (info.lowRes ? " (relance du lecteur en pleine qualité)" : ""));
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
  const randomId = () =>
    Array.from({ length: 32 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  const anonDeviceId = randomId();

  // 1) On capte les en-têtes GQL de Twitch, et on demande le flux principal en
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

  function headersForGql(anon) {
    if (anon) return { "Client-ID": CLIENT_ID, "Device-ID": anonDeviceId };
    const h = { "Client-ID": CLIENT_ID, "Device-ID": deviceId || anonDeviceId };
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
        headers: headersForGql(!!d.anon),
        body: d.body,
      });
      worker.postMessage({ key: "AB_FetchResponse", id: d.id, status: r.status, text: await r.text() });
    } catch (e) {
      worker.postMessage({ key: "AB_FetchResponse", id: d.id, status: 0, text: "" });
    }
  }

  // Lecteur Twitch (via React) pour pouvoir le relancer proprement
  function getPlayer() {
    try {
      const find = (node, test, depth) => {
        if (!node || depth > 4000) return null;
        if (node.stateNode && test(node.stateNode)) return node.stateNode;
        let n = node.child;
        while (n) {
          const r = find(n, test, depth + 1);
          if (r) return r;
          n = n.sibling;
        }
        return null;
      };
      const rootEl = document.querySelector("#root");
      if (!rootEl) return null;
      const key = Object.keys(rootEl).find((k) => k.startsWith("__reactContainer"));
      const root =
        (rootEl._reactRootContainer && rootEl._reactRootContainer._internalRoot && rootEl._reactRootContainer._internalRoot.current) ||
        (key && rootEl[key]);
      const comp = root && find(root, (s) => s.setPlayerActive && s.props && s.props.mediaPlayerInstance, 0);
      return comp ? comp.props.mediaPlayerInstance : null;
    } catch (e) {
      return null;
    }
  }

  let wasPlaying = true;
  function onAd(on, nudge) {
    const video = document.querySelector("video");
    if (on) {
      wasPlaying = !video || !video.paused;
      window.postMessage({ __gtoblock: "ad" }, "*");
      return;
    }
    if (!nudge || !wasPlaying) return;
    // On est passé par une qualité plus basse : on recale le lecteur sur le vrai flux
    setTimeout(() => {
      const player = getPlayer();
      try {
        if (player) {
          player.pause();
          player.play();
        } else if (video) {
          video.pause();
          video.play().catch(() => {});
        }
      } catch (e) {}
    }, 800);
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

  let RealWorker = window.Worker;
  while (RealWorker && (RealWorker.__gto || RealWorker.name === "GtoWorker")) RealWorker = Object.getPrototypeOf(RealWorker);

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
        else if (d.key === "AB_Ad") onAd(d.value, d.nudge);
      });
    }
  }
  GtoWorker.__gto = true;

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
