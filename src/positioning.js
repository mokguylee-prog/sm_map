// 타일 좌표 → 월드 좌표 오프셋 계산 헬퍼.

import { TILE_WORLD } from "./config.js";
import { els } from "./dom.js";
import { S } from "./state.js";

export function tileWorldSize() {
  return TILE_WORLD;
}

// 월드 원점 타일(worldOriginTileFloat) 기준 오프셋(타일 단위).
export function tileOffsetFromOrigin(tileFloat) {
  const limit = 2 ** Number(els.zoom.value);
  let x = tileFloat.x - S.worldOriginTileFloat.x;
  if (x > limit / 2) x -= limit;
  if (x < -limit / 2) x += limit;
  return {
    x,
    y: tileFloat.y - S.worldOriginTileFloat.y,
  };
}

// 임의의 앵커 타일 기준 오프셋(재중심 판단용).
export function tileOffsetFromAnchor(tileFloat, anchorTile) {
  const limit = 2 ** Number(els.zoom.value);
  let x = tileFloat.x - (anchorTile.x + 0.5);
  if (x > limit / 2) x -= limit;
  if (x < -limit / 2) x += limit;
  return {
    x,
    y: tileFloat.y - (anchorTile.y + 0.5),
  };
}
