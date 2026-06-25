// 실제 네트워크 송·수신량과 Cache Storage 재사용량을 분리해 누적한다.

const NET_STORAGE_KEY = "terrain-netstats-v2";

function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem(NET_STORAGE_KEY));
    if (saved && typeof saved === "object") {
      return {
        receivedBytes: Number(saved.receivedBytes) || 0,
        sentBytes: Number(saved.sentBytes) || 0,
        requests: Number(saved.requests) || 0,
        cacheBytes: Number(saved.cacheBytes) || 0,
        cacheHits: Number(saved.cacheHits) || 0,
      };
    }
  } catch {
    /* 무시 */
  }
  return { receivedBytes: 0, sentBytes: 0, requests: 0, cacheBytes: 0, cacheHits: 0 };
}

const stats = loadPersisted();

// 누적값을 localStorage에 저장한다. 타일마다 쓰면 과도하므로 호출 측에서 저빈도로 호출한다.
export function persistNetStats() {
  try {
    localStorage.setItem(NET_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* 무시 */
  }
}

// 누적량을 0으로 초기화한다.
export function resetNetStats() {
  stats.receivedBytes = 0;
  stats.sentBytes = 0;
  stats.requests = 0;
  stats.cacheBytes = 0;
  stats.cacheHits = 0;
  persistNetStats();
  onChange?.(getNetStats());
}

let onChange = null;

// 브라우저가 GET 요청에 붙이는 기본 헤더(Host, User-Agent, Accept 등) 대략치(바이트).
const REQUEST_HEADER_OVERHEAD = 300;

function estimateSentBytes(url) {
  const len = typeof url === "string" ? url.length : 0;
  return len + REQUEST_HEADER_OVERHEAD;
}

// 서비스 워커 캐시 적중은 네트워크량에 포함하지 않고 별도 집계한다.
export function recordRequest(url, receivedBytes, options = {}) {
  if (options.fromCache) {
    stats.cacheHits += 1;
    stats.cacheBytes += receivedBytes || 0;
    onChange?.(getNetStats());
    return;
  }
  stats.requests += 1;
  stats.receivedBytes += receivedBytes || 0;
  stats.sentBytes += estimateSentBytes(url);
  onChange?.(getNetStats());
}

export function getNetStats() {
  return { ...stats };
}

// 집계 변경 시 호출될 콜백 등록(1개). 갱신은 호출 측에서 프레임 단위로 코얼레싱한다.
export function onNetStatsChange(callback) {
  onChange = callback;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
