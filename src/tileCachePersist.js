// 영구 타일 캐시(서비스 워커 + Cache Storage)의 페이지 측 제어.
// 페이지는 같은 오리진이라 Cache Storage에 직접 접근할 수 있어 SW 메시징이 필요 없다.
//
// 주의: CACHE_NAME 은 sw.js 의 값과 반드시 동일하게 유지할 것.

const CACHE_NAME = "terrain-tiles-v1";

// 서비스 워커 등록(논블로킹). localhost/HTTPS에서만 동작한다.
export function registerTileCacheWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
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
