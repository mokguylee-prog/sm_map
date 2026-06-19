// 지명/국가 라벨 스프라이트. 현재 6x6 지형판 안에 들어오는 라벨만 표시한다.

import * as THREE from "three";
import { MAX_ZOOM } from "./config.js";
import { els } from "./dom.js";
import { S } from "./state.js";
import { PLACE_LABELS } from "../places.js";
import { latLonToTileFloat } from "./tileMath.js";
import { makeTextSprite } from "./sceneSetup.js";
import { sampleHeightAtWorld } from "./terrainMesh.js";
import { tileOffsetFromOrigin, tileWorldSize } from "./positioning.js";

// P2: 라벨 스프라이트를 시작 시 한꺼번에 만들지 않고, 처음 보일 때 생성해 캐시한다.
// (국가 196 + 지역 46 ≈ 250개 CanvasTexture 일괄 생성 회피)
const spriteByName = new Map();

export function buildPlaceLabels() {
  S.placeLabelGroup = new THREE.Group();
  S.scene.add(S.placeLabelGroup);
}

function getOrCreateSprite(place) {
  let sprite = spriteByName.get(place.name);
  if (sprite) return sprite;
  sprite = makeTextSprite(place.name, "#ffffff", {
    width: 384,
    height: 128,
    fontSize: place.name.length > 4 ? 46 : 56,
    bg: "rgba(31, 41, 37, 0.76)",
    stroke: "rgba(240, 199, 102, 0.5)",
  });
  sprite.userData.place = place;
  sprite.scale.set(260, 86, 1);
  sprite.visible = false;
  spriteByName.set(place.name, sprite);
  S.placeLabelGroup.add(sprite);
  return sprite;
}

export function updatePlaceLabels() {
  if (!S.placeLabelGroup || !S.currentTile || !S.worldOriginTileFloat) return;
  const z = Number(els.zoom.value);
  const tileWorld = tileWorldSize();
  const half = S.worldSize / 2;
  const waterLevel = S.currentGrid
    ? (S.currentGrid.min < -200 ? 0 : Math.max(0, S.currentGrid.min))
    : 0;
  const exaggeration = Number(els.exaggeration.value);

  PLACE_LABELS.forEach((place) => {
    const maxZoom = place.maxZoom ?? MAX_ZOOM;
    const inZoom = z >= place.minZoom && z <= maxZoom;

    // 줌 범위 밖이면 이미 만든 스프라이트만 숨기고, 새로 만들지 않는다.
    if (!inZoom) {
      const existing = spriteByName.get(place.name);
      if (existing) existing.visible = false;
      return;
    }

    const tileFloat = latLonToTileFloat(place.lat, place.lon, z);
    const offset = tileOffsetFromOrigin(tileFloat);
    const x = offset.x * tileWorld;
    const worldZ = offset.y * tileWorld;
    const localX = S.terrain ? x - S.terrain.position.x : x;
    const localZ = S.terrain ? worldZ - S.terrain.position.z : worldZ;
    const inPatch = localX >= -half && localX <= half && localZ >= -half && localZ <= half;

    if (!inPatch) {
      const existing = spriteByName.get(place.name);
      if (existing) existing.visible = false;
      return;
    }

    const sprite = getOrCreateSprite(place);
    const h = S.currentGrid ? sampleHeightAtWorld(localX, localZ) : 0;
    sprite.position.set(x, Math.max(80, (h - waterLevel) * exaggeration + 150), worldZ);
    sprite.visible = true;
  });
}
