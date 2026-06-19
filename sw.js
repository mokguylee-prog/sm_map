// 지형 타일 영구 캐시 서비스 워커 (cache-first).
// 모든 타일 fetch(앱 렌더링용 + bbox ZIP 다운로드용)를 투명하게 가로채
// Cache Storage에 저장/재사용한다. 새로고침·재방문·오프라인에서 즉시 로드.
//
// 주의: CACHE_NAME 은 src/tileCachePersist.js 의 값과 반드시 동일하게 유지할 것.

const CACHE_NAME = "terrain-tiles-v1";
const TILE_CACHE_LIMIT = 2000; // 캐시할 타일 개수 상한

// /{z}/{x}/{y}.(png|webp) 형태의 슬리피 타일 요청만 캐시 대상으로 본다.
// 호스트를 하드코딩하지 않으므로 AWS·Mapterhorn·Custom URL 모두 지원된다.
const TILE_PATH_RE = /\/\d+\/\d+\/\d+\.(png|webp)(\?|$)/;

function isTileRequest(request) {
  return request.method === "GET" && TILE_PATH_RE.test(new URL(request.url).pathname);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (isTileRequest(event.request)) {
    event.respondWith(cacheFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;

  // 미스: 네트워크에서 받아 캐시에 저장 후 반환.
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
    trimCache(cache); // 비동기, 응답 반환을 막지 않음
  }
  return response;
}

// 삽입 순서(가장 오래된 것이 앞)대로 상한 초과분을 제거한다.
async function trimCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - TILE_CACHE_LIMIT;
  for (let i = 0; i < overflow; i += 1) {
    await cache.delete(keys[i]);
  }
}
