// 전역 상수/설정값. 다른 모듈이 공유하는 순수 데이터만 둔다.

export const TILE_SIZE = 256;

// 화면에 이어 붙이는 지형판 크기 (가로/세로 타일 수)
export const PATCH_WIDTH = 6;
export const PATCH_NEGATIVE = 2; // 중심 타일 기준 음수 방향 타일 수
export const PATCH_POSITIVE = PATCH_WIDTH - PATCH_NEGATIVE - 1;

export const WORLD_SIZE = 7200; // 지형판의 월드 한 변 길이
export const MOVE_TILES_PER_SECOND = 0.85;
export const RECENTER_THRESHOLD_TILES = 2.25;
export const ZOOM_DEBOUNCE_MS = 260;
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
