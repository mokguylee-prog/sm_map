// 타일 URL 생성, 다운로드 + 디코딩, 패치(현재 줌 계획) 조립.

import { TILE_SIZE, TILE_CACHE_LIMIT, TILE_FETCH_CONCURRENCY } from "./config.js";
import { els } from "./dom.js";
import { clamp } from "./utils.js";

// P2: URL 키 LRU 캐시. 상한을 넘으면 가장 오래된 항목부터 제거한다.
const tileImageDataCache = new Map();

function cacheGet(url) {
  if (!tileImageDataCache.has(url)) return undefined;
  const value = tileImageDataCache.get(url);
  tileImageDataCache.delete(url);
  tileImageDataCache.set(url, value); // 최근 사용으로 갱신
  return value;
}

function cacheSet(url, value) {
  tileImageDataCache.set(url, value);
  if (tileImageDataCache.size > TILE_CACHE_LIMIT) {
    const oldest = tileImageDataCache.keys().next().value;
    tileImageDataCache.delete(oldest);
  }
}

export function tileUrl(x, y, z) {
  return els.url.value.replaceAll("{z}", z).replaceAll("{x}", x).replaceAll("{y}", y);
}

export async function fetchTileImageData(x, y, z) {
  const url = tileUrl(x, y, z);
  const cached = cacheGet(url);
  if (cached) return cached;

  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
  const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  cacheSet(url, imageData);
  return imageData;
}

// Terrarium 디코딩: height_m = R*256 + G + B/256 - 32768
export function decodeGrid(imageData, samples) {
  const heights = new Float32Array(samples * samples);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < samples; y += 1) {
    for (let x = 0; x < samples; x += 1) {
      const sx = Math.min(TILE_SIZE - 1, Math.round((x / (samples - 1)) * (TILE_SIZE - 1)));
      const sy = Math.min(TILE_SIZE - 1, Math.round((y / (samples - 1)) * (TILE_SIZE - 1)));
      const i = (sy * TILE_SIZE + sx) * 4;
      const h = imageData.data[i] * 256 + imageData.data[i + 1] + imageData.data[i + 2] / 256 - 32768;
      heights[y * samples + x] = h;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return { heights, samples, min, max };
}

export function emptyGrid(samples) {
  return {
    heights: new Float32Array(samples * samples),
    samples,
    min: 0,
    max: 0,
  };
}

// 중심 타일 주변 (plan) width x width 타일을 받아 하나의 높이 그리드로 합친다.
// plan = { width, negative, positive, samples, worldSize } (patchPlanForZoom 결과).
// S에 의존하지 않으므로, 호출자(terrainLoader)는 결과를 보고 커밋 여부를 결정할 수 있다.
function buildPatchTiles(centerTile, z, patchNegative, patchPositive) {
  const patchTiles = [];
  const limit = 2 ** z;
  for (let oy = -patchNegative; oy <= patchPositive; oy += 1) {
    for (let ox = -patchNegative; ox <= patchPositive; ox += 1) {
      patchTiles.push({
        x: (centerTile.x + ox + limit) % limit,
        y: clamp(centerTile.y + oy, 0, limit - 1),
        ox,
        oy,
      });
    }
  }
  patchTiles.sort((a, b) => {
    const da = Math.abs(a.ox) + Math.abs(a.oy);
    const db = Math.abs(b.ox) + Math.abs(b.oy);
    return da - db || Math.abs(a.oy) - Math.abs(b.oy) || Math.abs(a.ox) - Math.abs(b.ox);
  });
  return patchTiles;
}

function stitchTile(tile, grid, tileSamples, samples, patchNegative, heights) {
  const startX = (tile.ox + patchNegative) * (tileSamples - 1);
  const startY = (tile.oy + patchNegative) * (tileSamples - 1);
  for (let y = 0; y < tileSamples; y += 1) {
    for (let x = 0; x < tileSamples; x += 1) {
      const target = (startY + y) * samples + startX + x;
      heights[target] = grid.heights[y * tileSamples + x];
    }
  }
}

function patchSnapshot(state) {
  const min = Number.isFinite(state.min) ? state.min : 0;
  const max = Number.isFinite(state.max) ? state.max : 0;
  return {
    heights: state.heights,
    samples: state.samples,
    min,
    max,
    worldSize: state.worldSize,
    tileSamples: state.tileSamples,
    totalTiles: state.totalTiles,
    missingTiles: state.settledTiles - state.loadedTiles,
    loadedTiles: state.loadedTiles,
  };
}

export async function loadTerrainPatch(centerTile, z, plan, onPartial) {
  const { width: patchWidth, negative: patchNegative, positive: patchPositive, samples: tileSamples, worldSize } = plan;
  const patchTiles = buildPatchTiles(centerTile, z, patchNegative, patchPositive);
  const samples = tileSamples * patchWidth - (patchWidth - 1);
  const state = {
    heights: new Float32Array(samples * samples),
    samples,
    min: Infinity,
    max: -Infinity,
    worldSize,
    tileSamples,
    totalTiles: patchTiles.length,
    loadedTiles: 0,
    settledTiles: 0,
  };

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < patchTiles.length) {
      const tile = patchTiles[nextIndex];
      nextIndex += 1;
      try {
        const imageData = await fetchTileImageData(tile.x, tile.y, z);
        const grid = decodeGrid(imageData, tileSamples);
        stitchTile(tile, grid, tileSamples, samples, patchNegative, state.heights);
        state.min = Math.min(state.min, grid.min);
        state.max = Math.max(state.max, grid.max);
        state.loadedTiles += 1;
      } catch {
        // 없는 타일은 0m 평면으로 남겨두고, 들어온 타일부터 먼저 보여준다.
      }
      state.settledTiles += 1;
      onPartial?.(patchSnapshot(state));
    }
  }

  const workers = Array.from(
    { length: Math.min(TILE_FETCH_CONCURRENCY, patchTiles.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return patchSnapshot(state);
}
