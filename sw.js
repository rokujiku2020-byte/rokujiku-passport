/* ろくじく — Service Worker
   目的：オフラインでも起動できるようにする（通勤中の地下鉄など）
   方針：
     - アプリ本体（HTML）はネットワーク優先。更新をその場で反映する。
       通信が無い／遅いときだけキャッシュに切り替えるので、オフライン起動は従来どおり。
       ※以前は「キャッシュを先に返して裏で更新」だったため、更新が見えるのが常に次回起動時になり、
         古い画面が残っているように見える問題があった（2026-07-28 修正）。
     - アイコン等の変わらないファイルはキャッシュ優先のまま（表示を速くするため）。
   更新方法：下の CACHE の数字を1つ増やす（tools/build.sh が自動で行う） */
const CACHE = "genai-passport-v18";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];
/* 通信がこの時間で応答しなければキャッシュに切り替える（体感を落とさないため） */
const NET_TIMEOUT = 2500;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* アプリ本体かどうか（ページそのものの読み込み） */
function isAppShell(req, url) {
  return req.mode === "navigate" ||
         url.pathname.endsWith("/") ||
         url.pathname.endsWith("/index.html");
}

function fromCache(req) {
  return caches.match(req)
    .then((c) => c || caches.match("./index.html"))
    .then((c) => c || new Response("", { status: 504, statusText: "offline" }));
}

function putCache(req, res) {
  if (res && res.status === 200) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
}

/* ネットワーク優先：応答がなければ時間切れでキャッシュへ */
function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const useCache = () => {
      if (settled) return;
      settled = true;
      resolve(fromCache(req));
    };
    const timer = setTimeout(useCache, NET_TIMEOUT);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      putCache(req, res);
      resolve(res);
    }).catch(() => {
      clearTimeout(timer);
      useCache();
    });
  });
}

/* キャッシュ優先：あれば即返し、裏で更新しておく */
function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    const network = fetch(req).then((res) => { putCache(req, res); return res; })
                              .catch(() => fromCache(req));
    return cached || network;
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(isAppShell(req, url) ? networkFirst(req) : cacheFirst(req));
});
