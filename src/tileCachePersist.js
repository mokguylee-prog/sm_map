// 영구 타일 캐시(서비스 워커 + Cache Storage)의 페이지 측 제어.
// 페이지는 같은 오리진이라 Cache Storage에 직접 접근할 수 있어 SW 메시징이 필요 없다.
//
// 주의: CACHE_NAME 은 sw.js 의 값과 반드시 동일하게 유지할 것.

const CACHE_NAME = "terrain-tiles-v1";
const CACHE_STATUS_HEADER = "X-Terrain-Cache";

// 서비스 워커 등록 후 현재 페이지 제어까지 기다린다.
// 첫 지형 요청부터 Cache Storage를 사용하게 해 새로고침 직후의 중복 다운로드를 막는다.
export async function registerTileCacheWorker() {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    return Boolean(navigator.serviceWorker.controller);
  } catch {
    return false;
  }
}

// 현재 캐시된 타일 개수.
export async function tileCacheCount() {
  if (!("caches" in window)) return 0;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.length;
  } catch {
    return 0;
  }
}

// 캐시 비우기.
export async function clearTileCache() {
  if (!("caches" in window)) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* 무시 */
  }
}

// 페이지에서 Cache Storage를 먼저 직접 조회한다.
// 서비스 워커 제어 시점이나 브라우저 HTTP 캐시 상태와 관계없이 동일 타일의 재다운로드를 막는다.
export async function fetchTileResource(url, options = {}) {
  const cacheKey = new Request(url, { mode: "cors" });
  let cache = null;
  if ("caches" in window) {
    try {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(cacheKey);
      if (hit) return { response: hit, fromCache: true };
    } catch {
      cache = null;
    }
  }

  const response = await fetch(url, { mode: "cors", signal: options.signal });
  const fromServiceWorkerCache = response.headers.get(CACHE_STATUS_HEADER) === "hit";
  if (response.ok && cache && !fromServiceWorkerCache) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      /* 캐시 저장 실패 시 네트워크 응답은 그대로 사용 */
    }
  }
  return { response, fromCache: fromServiceWorkerCache };
}
