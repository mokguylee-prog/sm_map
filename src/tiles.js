// 타일 URL 생성, 다운로드 + 디코딩, 패치(현재 줌 계획) 조립.

import { TILE_SIZE, TILE_CACHE_LIMIT, TILE_FETCH_CONCURRENCY, MIN_ZOOM } from "./config.js";
import { els } from "./dom.js";
import { clamp } from "./utils.js";
import { recordRequest } from "./netStats.js";
import { fetchTileResource } from "./tileCachePersist.js";

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

export async function fetchTileImageData(x, y, z, signal) {
  const url = tileUrl(x, y, z);
  const cached = cacheGet(url);
  if (cached) return cached;

  const { response, fromCache } = await fetchTileResource(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  recordRequest(url, blob.size, { fromCache });
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

export async function fetchTileImageDataWithFallback(x, y, z, signal) {
  try {
    return {
      imageData: await fetchTileImageData(x, y, z, signal),
      fallbackZ: null,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    for (let parentZ = z - 1; parentZ >= MIN_ZOOM; parentZ -= 1) {
      try {
        return {
          imageData: await fetchParentTileImageData(x, y, z, parentZ, signal),
          fallbackZ: parentZ,
        };
      } catch {
        if (signal?.aborted) throw error;
      }
    }
    throw error;
  }
}

async function fetchParentTileImageData(x, y, z, parentZ, signal) {
  const fallbackKey = `${tileUrl(x, y, z)}#fallback-parent-z${parentZ}`;
  const cached = cacheGet(fallbackKey);
  if (cached) return cached;

  const scale = 2 ** (z - parentZ);
  const parentLimit = 2 ** parentZ;
  const parentX = Math.floor(x / scale) % parentLimit;
  const parentY = clamp(Math.floor(y / scale), 0, parentLimit - 1);
  const parentImageData = await fetchTileImageData(parentX, parentY, parentZ, signal);
  const imageData = cropParentTile(parentImageData, x, y, scale);
  cacheSet(fallbackKey, imageData);
  return imageData;
}

function cropParentTile(parentImageData, x, y, scale) {
  const parentCanvas = document.createElement("canvas");
  parentCanvas.width = TILE_SIZE;
  parentCanvas.height = TILE_SIZE;
  const parentCtx = parentCanvas.getContext("2d");
  parentCtx.putImageData(parentImageData, 0, 0);

  const childPixelSize = TILE_SIZE / scale;
  const sourceSize = Math.max(1, childPixelSize);
  const sx = Math.min(TILE_SIZE - sourceSize, Math.floor((x % scale) * childPixelSize));
  const sy = Math.min(TILE_SIZE - sourceSize, Math.floor((y % scale) * childPixelSize));

  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(parentCanvas, sx, sy, sourceSize, sourceSize, 0, 0, TILE_SIZE, TILE_SIZE);
  return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
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
      const y = centerTile.y + oy;
      if (y < 0 || y >= limit) continue;
      patchTiles.push({
        x: (centerTile.x + ox + limit) % limit,
        y,
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
    fallbackTiles: state.fallbackTiles,
  };
}

export async function loadTerrainPatch(centerTile, z, plan, onPartial, options = {}) {
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
    fallbackTiles: 0,
    settledTiles: 0,
  };

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < patchTiles.length && !options.signal?.aborted) {
      const tile = patchTiles[nextIndex];
      nextIndex += 1;
      try {
        const { imageData, fallbackZ } = await fetchTileImageDataWithFallback(tile.x, tile.y, z, options.signal);
        if (options.signal?.aborted) return;
        const grid = decodeGrid(imageData, tileSamples);
        stitchTile(tile, grid, tileSamples, samples, patchNegative, state.heights);
        state.min = Math.min(state.min, grid.min);
        state.max = Math.max(state.max, grid.max);
        state.loadedTiles += 1;
        if (fallbackZ != null) state.fallbackTiles += 1;
      } catch {
        if (options.signal?.aborted) return;
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
