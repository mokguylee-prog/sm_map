// 전역 상수/설정값. 다른 모듈이 공유하는 순수 데이터만 둔다.

export const TILE_SIZE = 256;

// 타일 한 칸의 월드 크기(고정). 지형판 전체 크기 = 패치 폭 × 이 값.
export const TILE_WORLD = 1200;

// 패치 기하중심이 중심 타일로부터 떨어진 거리(타일 단위).
// 모든 패치를 negative = width/2 - 1 로 구성하므로 이 값은 항상 1이다.
// (메시 월드 원점(0,0)에 해당하는 타일 좌표 = 중심타일 + 이 값.)
// 라벨/마커/패치 위치의 기준으로 일관되게 써야 지명이 실제 좌표에 정확히 찍힌다.
export const PATCH_CENTER_OFFSET = 1;

// 줌별 패치 계획.
// 줌 아웃일수록 더 넓은 패치(타일 수↑)를 낮은 해상도(타일당 샘플↓)로 불러와,
// 지형판이 화면을 더 넓게 덮어 '여백'(지형판 밖 빈 공간)을 줄인다.
// 모두 짝수 폭 + negative = width/2 - 1 → 패치 중심 오프셋이 항상 1로 유지된다.
// samples=초기(빠른) 타일당 샘플, refineSamples=화면이 멈춰 있을 때 올릴 고해상 샘플.
export function patchPlanForZoom(z) {
  if (z >= 14) return makePlan(6, 65, 193);
  if (z >= 12) return makePlan(6, 57, 161);
  if (z >= 9) return makePlan(8, 41, 121);
  if (z >= 7) return makePlan(10, 33, 89);
  if (z >= 5) return makePlan(12, 29, 61);
  return makePlan(14, 25, 45);
}

function makePlan(width, samples, refineSamples) {
  const negative = width / 2 - 1;
  return {
    width,
    negative,
    positive: width - negative - 1,
    samples,
    refineSamples,
    worldSize: width * TILE_WORLD,
  };
}

// 확대 후 화면이 이 시간(ms)만큼 멈춰 있으면 고해상으로 정밀화한다.
export const REFINE_DELAY_MS = 900;
export const STREAM_RENDER_THROTTLE_MS = 120;
export const TILE_FETCH_CONCURRENCY = 16;

export const MOVE_TILES_PER_SECOND = 0.85;
export const RECENTER_THRESHOLD_TILES = 2.25;
export const ZOOM_DEBOUNCE_MS = 60;
// 휠 줌 쿨다운(ms). 이 시간 안에 들어온 추가 휠 이벤트는 무시해 줌을 둔감하게 한다.
export const WHEEL_ZOOM_COOLDOWN_MS = 150;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 15;

export const STORAGE_KEY = "terrain-webapp-state-v1";

export const SOURCES = {
  aws: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  mapterhorn: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
};

// P2: 타일 이미지 캐시 상한(LRU). 장시간 이동 시 메모리 무한 증가 방지.
export const TILE_CACHE_LIMIT = 320;

// P2: bbox ZIP 다운로드 동시 요청 수.
export const DOWNLOAD_CONCURRENCY = 6;
