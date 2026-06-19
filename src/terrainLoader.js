// 지형 로딩 오케스트레이션: 패치 다운로드 → 메시 렌더 → 패치 위치/마커/라벨 갱신.

import * as THREE from "three";
import { PATCH_CENTER_OFFSET, MIN_ZOOM, MAX_ZOOM, patchPlanForZoom, REFINE_DELAY_MS } from "./config.js";
import { els, setStatus } from "./dom.js";
import { S, pressedKeys } from "./state.js";
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
  window.clearTimeout(S.refineTimer); // 새 로드 시작 → 대기 중인 정밀화 취소
  const lat = clamp(Number(els.lat.value), -85, 85);
  const lon = wrapLon(Number(els.lon.value));
  const z = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  els.lat.value = lat.toFixed(6);
  els.lon.value = lon.toFixed(6);
  els.zoom.value = z;
  saveState();

  const plan = patchPlanForZoom(z);
  const tile = latLonToTile(lat, lon, z);
  setStatus(`주변 타일 로딩: ${plan.width * plan.width}개 (z${z}/${tile.x}/${tile.y} 중심)`);
  els.tileHud.textContent = `z${z}/${tile.x}/${tile.y}`;

  try {
    // 패치를 먼저 받는다. plan을 직접 넘기므로 이 시점엔 S(표시 상태)를 건드리지 않는다.
    const grid = await loadTerrainPatch(tile, z, plan);
    if (version !== S.loadVersion) return;

    // 타일이 전부 없는 구간(예: Mapterhorn은 한국 z13+ 전부 404):
    // 화면을 비우거나 멈추지 않도록 한다. 마지막으로 표시된 줌으로 되돌려
    // 이전 지형을 계속 보여주고, 더 이상 들어갈 수 없음을 알린다.
    if (grid.loadedTiles === 0) {
      els.coverageHud.textContent = `0/${grid.totalTiles}`;
      if (S.lastGoodZoom != null && S.lastGoodZoom !== z) {
        els.zoom.value = S.lastGoodZoom;
        saveState();
        if (S.currentTile) {
          els.tileHud.textContent = `z${S.currentTile.z}/${S.currentTile.x}/${S.currentTile.y}`;
        }
        setStatus(`이 소스는 z${z}에 데이터가 없습니다. z${S.lastGoodZoom}로 되돌립니다. (다른 소스를 써보세요)`);
      } else {
        setStatus(`타일 없음: z${z}/${tile.x}/${tile.y} 주변에 데이터가 없습니다.`);
      }
      return;
    }

    // 여기서부터 새 패치를 표시 상태(S)에 커밋한다.
    const widthChanged = plan.width !== S.patchWidth;
    S.patchWidth = plan.width;
    S.patchNegative = plan.negative;
    S.patchPositive = plan.positive;
    S.tileSamples = plan.samples;
    S.worldSize = plan.worldSize;
    if (widthChanged) rebuildFrame();

    if (!S.worldOriginTileFloat || options.resetOrigin || S.worldOriginTileFloat.z !== z) {
      // 패치 기하중심을 월드 원점으로 (타일 중심 +0.5 가 아니라 패치 중심 오프셋).
      S.worldOriginTileFloat = {
        x: tile.x + PATCH_CENTER_OFFSET,
        y: tile.y + PATCH_CENTER_OFFSET,
        z,
      };
    }
    S.currentTile = tile;
    S.currentGrid = grid;
    S.lastGoodZoom = z;
    renderTerrain(grid, options);
    updatePatchPosition();
    updatePlayerMarker();
    updatePlaceLabels();
    fillBboxFromCurrent();
    els.rangeHud.textContent = `${Math.round(grid.min)}m..${Math.round(grid.max)}m`;
    els.resolutionHud.textContent = `${grid.tileSamples}x${grid.tileSamples} / tile`;
    els.coverageHud.textContent = `${grid.loadedTiles}/${grid.totalTiles}`;
    const missingText = grid.missingTiles
      ? `일부 타일 없음: ${grid.missingTiles}/${grid.totalTiles}개. 빈 칸은 평지로 표시됩니다.`
      : `표시 중: ${S.patchWidth}x${S.patchWidth} tiles, samples ${grid.tileSamples} at z${z}/${tile.x}/${tile.y} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
    setStatus(missingText);

    // 화면이 멈춰 있으면 같은 패치를 더 촘촘히 다시 디코딩해 고해상으로 정밀화한다.
    scheduleRefine(tile, z, plan, version);
  } catch (error) {
    setStatus(`타일 로딩 실패: ${error.message}`);
  }
}

// 정밀화: 대기 후에도 같은 로드가 유효하고 이동 중이 아니면, 캐시된 타일을 더 높은 샘플로
// 재디코딩(네트워크 없음)해 메시만 교체한다. 카메라 뷰는 유지한다.
function scheduleRefine(tile, z, plan, version) {
  if (!plan.refineSamples || plan.refineSamples <= plan.samples) return;
  window.clearTimeout(S.refineTimer);
  S.refineTimer = window.setTimeout(async () => {
    if (version !== S.loadVersion || pressedKeys.size) return;
    try {
      const refined = await loadTerrainPatch(tile, z, { ...plan, samples: plan.refineSamples });
      if (version !== S.loadVersion || refined.loadedTiles === 0) return;
      S.currentGrid = refined;
      S.tileSamples = refined.tileSamples;
      renderTerrain(refined, { keepCamera: true });
      updatePatchPosition();
      updatePlayerMarker();
      updatePlaceLabels();
      els.resolutionHud.textContent = `${refined.tileSamples}x${refined.tileSamples} / tile (고해상)`;
    } catch {
      /* 정밀화 실패는 무시(기본 해상도 유지) */
    }
  }, REFINE_DELAY_MS);
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
