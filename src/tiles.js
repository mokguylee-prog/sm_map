// 타일 URL 생성, 다운로드 + 디코딩, 6x6 패치 조립.

import { TILE_SIZE, TILE_CACHE_LIMIT, PATCH_WIDTH, PATCH_NEGATIVE, PATCH_POSITIVE, WORLD_SIZE } from "./config.js";
import { els } from "./dom.js";
import { clamp } from "./utils.js";
import { samplesForZoom } from "./tileMath.js";

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

// 중심 타일 주변 PATCH_WIDTH x PATCH_WIDTH 타일을 받아 하나의 높이 그리드로 합친다.
export async function loadTerrainPatch(centerTile, z) {
  const patchTiles = [];
  const limit = 2 ** z;
  const tileSamples = samplesForZoom(z);
  for (let oy = -PATCH_NEGATIVE; oy <= PATCH_POSITIVE; oy += 1) {
    for (let ox = -PATCH_NEGATIVE; ox <= PATCH_POSITIVE; ox += 1) {
      patchTiles.push({
        x: (centerTile.x + ox + limit) % limit,
        y: clamp(centerTile.y + oy, 0, limit - 1),
        ox,
        oy,
      });
    }
  }

  const decodedTiles = await Promise.all(
    patchTiles.map(async (tile) => {
      try {
        const imageData = await fetchTileImageData(tile.x, tile.y, z);
        return { ...tile, grid: decodeGrid(imageData, tileSamples), missing: false };
      } catch (error) {
        return { ...tile, grid: emptyGrid(tileSamples), missing: true, error };
      }
    }),
  );

  const tilesWide = PATCH_WIDTH;
  const samples = tileSamples * tilesWide - (tilesWide - 1);
  const heights = new Float32Array(samples * samples);
  const missingTiles = decodedTiles.filter((tile) => tile.missing).length;
  let min = Infinity;
  let max = -Infinity;

  decodedTiles.forEach((tile) => {
    const startX = (tile.ox + PATCH_NEGATIVE) * (tileSamples - 1);
    const startY = (tile.oy + PATCH_NEGATIVE) * (tileSamples - 1);
    for (let y = 0; y < tileSamples; y += 1) {
      for (let x = 0; x < tileSamples; x += 1) {
        const h = tile.grid.heights[y * tileSamples + x];
        const target = (startY + y) * samples + startX + x;
        heights[target] = h;
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }

  return {
    heights,
    samples,
    min,
    max,
    worldSize: WORLD_SIZE,
    tileSamples,
    totalTiles: decodedTiles.length,
    missingTiles,
    loadedTiles: decodedTiles.length - missingTiles,
  };
}
