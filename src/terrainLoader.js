// 지형 로딩 오케스트레이션: 패치 다운로드 → 메시 렌더 → 패치 위치/마커/라벨 갱신.

import * as THREE from "three";
import { PATCH_CENTER_OFFSET, MIN_ZOOM, MAX_ZOOM, patchPlanForZoom } from "./config.js";
import { els, setStatus } from "./dom.js";
import { S } from "./state.js";
import { clamp, wrapLon } from "./utils.js";
import { latLonToTile, latLonToTileFloat } from "./tileMath.js";
import { loadTerrainPatch } from "./tiles.js";
import { renderTerrain, sampleHeightAtWorld } from "./terrainMesh.js";
import { updatePlaceLabels } from "./labels.js";
import { fillBboxFromCurrent } from "./download.js";
import { saveState } from "./storage.js";
import { rebuildFrame } from "./sceneSetup.js";
import { tileWorldSize, tileOffsetFromOrigin } from "./positioning.js";

export async function loadTerrain(options = {}) {
  const version = ++S.loadVersion;
  const lat = clamp(Number(els.lat.value), -85, 85);
  const lon = wrapLon(Number(els.lon.value));
  const z = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  els.lat.value = lat.toFixed(6);
  els.lon.value = lon.toFixed(6);
  els.zoom.value = z;
  saveState();

  // 줌별 패치 계획 적용. 폭이 바뀌면 지형판 프레임(그리드/경계선/방위표)도 재구축.
  const plan = patchPlanForZoom(z);
  const widthChanged = plan.width !== S.patchWidth;
  S.patchWidth = plan.width;
  S.patchNegative = plan.negative;
  S.patchPositive = plan.positive;
  S.tileSamples = plan.samples;
  S.worldSize = plan.worldSize;
  if (widthChanged) rebuildFrame();

  const tile = latLonToTile(lat, lon, z);
  if (!S.worldOriginTileFloat || options.resetOrigin || S.worldOriginTileFloat.z !== z) {
    // 패치 기하중심을 월드 원점으로 (타일 중심 +0.5 가 아니라 패치 중심 오프셋).
    S.worldOriginTileFloat = {
      x: tile.x + PATCH_CENTER_OFFSET,
      y: tile.y + PATCH_CENTER_OFFSET,
      z,
    };
  }
  S.currentTile = tile;
  setStatus(`주변 타일 로딩: ${S.patchWidth * S.patchWidth}개 (z${z}/${tile.x}/${tile.y} 중심)`);
  els.tileHud.textContent = `z${z}/${tile.x}/${tile.y}`;

  try {
    const grid = await loadTerrainPatch(tile, z);
    if (version !== S.loadVersion) return;
    S.currentGrid = grid;
    renderTerrain(grid, options);
    updatePatchPosition();
    updatePlayerMarker();
    updatePlaceLabels();
    fillBboxFromCurrent();
    els.rangeHud.textContent = `${Math.round(grid.min)}m..${Math.round(grid.max)}m`;
    els.resolutionHud.textContent = `${grid.tileSamples}x${grid.tileSamples} / tile`;
    els.coverageHud.textContent = `${grid.loadedTiles}/${grid.totalTiles}`;
    const missingText = grid.missingTiles
      ? `타일 없음: ${grid.missingTiles}/${grid.totalTiles}개. 이 줌/위치는 데이터가 없을 수 있습니다.`
      : `표시 중: ${S.patchWidth}x${S.patchWidth} tiles, samples ${grid.tileSamples} at z${z}/${tile.x}/${tile.y} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
    setStatus(missingText);
  } catch (error) {
    setStatus(`타일 로딩 실패: ${error.message}`);
  }
}

// 지형 강조(exaggeration) 변경 시 카메라 유지한 채 메시만 다시 만든다.
export function applyExaggeration() {
  if (!S.currentGrid) return;
  renderTerrain(S.currentGrid, { keepCamera: true });
  updatePatchPosition();
  updatePlaceLabels();
}

export function updatePatchPosition() {
  if (!S.currentTile || !S.worldOriginTileFloat) return;
  // 메시 콘텐츠 중심 = 현재 패치의 기하중심(타일 중심이 아님).
  const center = {
    x: S.currentTile.x + PATCH_CENTER_OFFSET,
    y: S.currentTile.y + PATCH_CENTER_OFFSET,
  };
  const offset = tileOffsetFromOrigin(center);
  const tileWorld = tileWorldSize();
  const x = offset.x * tileWorld;
  const z = offset.y * tileWorld;
  if (S.terrain) S.terrain.position.set(x, 0, z);
  if (S.tileBoundaryGroup) S.tileBoundaryGroup.position.set(x, 0, z);
  if (S.directionGroup) S.directionGroup.position.set(x, 0, z);
  updatePlaceLabels();
}

export function updatePlayerMarker() {
  if (!S.playerMarker || !S.currentTile || !S.worldOriginTileFloat) return;
  const z = Number(els.zoom.value);
  const pos = latLonToTileFloat(Number(els.lat.value), Number(els.lon.value), z);
  const tileWorld = tileWorldSize();
  const offset = tileOffsetFromOrigin(pos);
  const x = offset.x * tileWorld;
  const worldZ = offset.y * tileWorld;
  const localX = S.terrain ? x - S.terrain.position.x : x;
  const localZ = S.terrain ? worldZ - S.terrain.position.z : worldZ;
  const h = S.currentGrid ? sampleHeightAtWorld(localX, localZ) : 0;
  const waterLevel = S.currentGrid
    ? (S.currentGrid.min < -200 ? 0 : Math.max(0, S.currentGrid.min))
    : 0;
  S.playerMarker.position.set(
    x,
    Math.max(28, (h - waterLevel) * Number(els.exaggeration.value) + 42),
    worldZ,
  );
  const desiredTarget = new THREE.Vector3(x, S.playerMarker.position.y, worldZ);
  const cameraFollowDelta = desiredTarget.clone().sub(S.controls.target).multiplyScalar(0.18);
  S.controls.target.add(cameraFollowDelta);
  S.camera.position.add(cameraFollowDelta);
}
