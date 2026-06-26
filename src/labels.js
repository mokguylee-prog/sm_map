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
const ALWAYS_VISIBLE_LABELS = new Set(["대한민국", "에베레스트산"]);

// 산 실제 표고: 화면 줌과 무관하게 AWS 고줌(z13) 타일에서 봉우리 표고를 읽어 둔다.
// (현재 렌더 소스가 맵터호른이면 z13이 없으므로, 정확도를 위해 AWS를 직접 조회한다.)
const AWS_TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const PEAK_ZOOM = 13;
const peakEleByName = new Map(); // name -> number(m) | "pending" | "failed"
const clampPx = (v) => Math.min(255, Math.max(0, v));

async function loadPeakElevation(place) {
  if (peakEleByName.has(place.name)) return;
  peakEleByName.set(place.name, "pending");
  try {
    const z = PEAK_ZOOM;
    const tf = latLonToTileFloat(place.lat, place.lon, z);
    const tx = Math.floor(tf.x);
    const ty = Math.floor(tf.y);
    const response = await fetch(`${AWS_TERRARIUM}/${z}/${tx}/${ty}.png`, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 256, 256);
    const { data } = ctx.getImageData(0, 0, 256, 256);
    // 라벨 좌표 주변 작은 창에서 최댓값(봉우리) 추출.
    const px = clampPx(Math.floor((tf.x - tx) * 256));
    const py = clampPx(Math.floor((tf.y - ty) * 256));
    const R = 5;
    let max = -Infinity;
    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const i = (clampPx(py + dy) * 256 + clampPx(px + dx)) * 4;
        const h = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
        if (h > max) max = h;
      }
    }
    peakEleByName.set(place.name, Math.round(max));
    updatePlaceLabels(); // 정확한 표고로 라벨 텍스트 갱신
  } catch {
    peakEleByName.set(place.name, "failed");
  }
}

function labelKey(place) {
  return `${place.type ?? "place"}:${place.country ?? ""}:${place.name}`;
}

export function applyPlaceLabelScale(scale) {
  S.labelScale = scale;
  spriteByName.forEach((sprite) => {
    const baseScale = sprite.userData.baseScale;
    if (baseScale) {
      sprite.scale.set(baseScale.x * scale, baseScale.y * scale, 1);
    }
  });
}

export function buildPlaceLabels() {
  S.placeLabelGroup = new THREE.Group();
  S.scene.add(S.placeLabelGroup);
}

function disposeSprite(sprite) {
  S.placeLabelGroup.remove(sprite);
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

// '산' 접미사를 쓰지만 산이 아닌 도시들(고도 표시에서 제외).
const CITY_NAMES_WITH_MOUNTAIN_SUFFIX = new Set(["부산", "울산", "마산", "군산", "익산", "논산", "아산", "오산"]);

// 산 판별: type이 mountain이면 산. 다른 type(수도/도시/산맥 등)은 산 아님.
// type이 없는 지역 라벨만 이름 접미사(산/봉/령/악)로 판정하되, 산-접미 도시는 제외한다.
function isMountainPlace(place) {
  if (place.type === "mountain") return true;
  if (place.type) return false;
  if (CITY_NAMES_WITH_MOUNTAIN_SUFFIX.has(place.name)) return false;
  return /(산|봉|령|악)$/.test(place.name);
}

function getOrCreateSprite(place, elevationM) {
  const key = labelKey(place);
  const isMountain = isMountainPlace(place);
  // 산은 이름 옆에 지형에서 읽은 고도를 붙인다(해수면 이하/미로딩이면 생략).
  const eleText = isMountain && Number.isFinite(elevationM) && elevationM > 0
    ? ` ${Math.round(elevationM).toLocaleString()}m`
    : "";

  let sprite = spriteByName.get(key);
  if (sprite) {
    if (!isMountain || sprite.userData.eleText === eleText) return sprite;
    // 산: 표시 고도가 바뀌면(정밀화 등) 텍스트 갱신을 위해 다시 만든다.
    disposeSprite(sprite);
    spriteByName.delete(key);
  }

  const isCapital = place.type === "capital";
  const isMajorCity = place.type === "majorCity";
  const isKoreaCity = place.type === "koreaCity";
  const isMountainRange = place.type === "mountainRange";
  sprite = makeTextSprite(place.name + eleText, "#ffffff", {
    width: isCapital ? 560 : (isMountainRange ? 512 : (isMountain ? 560 : 384)),
    height: 128,
    fontSize: isCapital ? 62 : (isMountainRange ? 42 : (isMountain ? 44 : ((isMajorCity || isKoreaCity) ? 44 : (place.name.length > 4 ? 46 : 56)))),
    bg: isCapital
      ? "rgba(12, 104, 61, 0.9)"
      : (isMountainRange
        ? "rgba(78, 61, 24, 0.78)"
        : (isMajorCity
          ? "rgba(23, 59, 91, 0.78)"
          : (isKoreaCity ? "rgba(28, 67, 92, 0.78)" : "rgba(31, 41, 37, 0.76)"))),
    stroke: isCapital
      ? "rgba(92, 232, 151, 0.9)"
      : (isMountainRange
        ? "rgba(240, 199, 102, 0.72)"
        : (isMajorCity
          ? "rgba(111, 193, 255, 0.72)"
          : (isKoreaCity ? "rgba(120, 211, 255, 0.72)" : "rgba(240, 199, 102, 0.5)"))),
  });
  sprite.userData.place = place;
  sprite.userData.eleText = eleText;
  sprite.userData.baseScale = {
    x: isCapital ? 520 : (isMountainRange ? 360 : (isMountain ? 400 : ((isMajorCity || isKoreaCity) ? 290 : 260))),
    y: isCapital ? 128 : 86,
  };
  sprite.scale.set(
    sprite.userData.baseScale.x * S.labelScale,
    sprite.userData.baseScale.y * S.labelScale,
    1,
  );
  sprite.visible = false;
  spriteByName.set(key, sprite);
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
    const inZoom = ALWAYS_VISIBLE_LABELS.has(place.name)
      || (z >= place.minZoom && z <= maxZoom);

    // 줌 범위 밖이면 이미 만든 스프라이트만 숨기고, 새로 만들지 않는다.
    if (!inZoom) {
      const existing = spriteByName.get(labelKey(place));
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
      const existing = spriteByName.get(labelKey(place));
      if (existing) existing.visible = false;
      return;
    }

    const h = S.currentGrid ? sampleHeightAtWorld(localX, localZ) : 0;
    // 산 라벨 고도는 정확한 봉우리 표고(AWS z13)를 우선 사용하고, 도착 전엔 화면 샘플값으로 대체.
    let elevationForLabel = h;
    if (isMountainPlace(place)) {
      loadPeakElevation(place);
      const peak = peakEleByName.get(place.name);
      if (typeof peak === "number") elevationForLabel = peak;
    }
    const sprite = getOrCreateSprite(place, elevationForLabel);
    sprite.position.set(x, Math.max(80, (h - waterLevel) * exaggeration + 150), worldZ);
    sprite.visible = true;
  });
}
