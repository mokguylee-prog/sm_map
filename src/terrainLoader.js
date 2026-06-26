// 지형 로딩 오케스트레이션: 패치 다운로드 → 메시 렌더 → 패치 위치/마커/라벨 갱신.

import * as THREE from "three";
import {
  PATCH_CENTER_OFFSET,
  MIN_ZOOM,
  MAX_ZOOM,
  NAV_LAT_MAX,
  NAV_LAT_MIN,
  patchPlanForZoom,
  scalePlanResolution,
  REFINE_DELAY_MS,
  STREAM_RENDER_THROTTLE_MS,
  TILE_WORLD,
} from "./config.js";
import { els, setStatus } from "./dom.js";
import { S, pressedKeys } from "./state.js";
import { clamp, wrapLon } from "./utils.js";
import { latLonToTile, latLonToTileFloat } from "./tileMath.js";
import { loadTerrainPatch } from "./tiles.js";
import { clearBackfillTerrain, renderBackfillTerrain, renderTerrain, sampleHeightAtWorld } from "./terrainMesh.js";
import { updatePlaceLabels } from "./labels.js";
import { fillBboxFromCurrent } from "./download.js";
import { saveState } from "./storage.js";
import { rebuildFrame } from "./sceneSetup.js";
import { tileWorldSize, tileOffsetFromOrigin } from "./positioning.js";

const BACKFILL_ZOOM_DELTA = 3;
const BACKFILL_WIDTH = 8;
const BACKFILL_TILE_SAMPLES = 25;

export async function loadTerrain(options = {}) {
  const version = ++S.loadVersion;
  const viewAnchor = options.viewAnchor ?? null;
  let viewAnchorApplied = false;
  S.loadAbortController?.abort();
  const abortController = new AbortController();
  S.loadAbortController = abortController;
  clearBackfillTerrain();
  S.backfillGrid = null;
  S.backfillTile = null;
  S.backfillScale = 1;
  window.clearTimeout(S.refineTimer); // 새 로드 시작 → 대기 중인 정밀화 취소
  const lat = clamp(Number(els.lat.value), NAV_LAT_MIN, NAV_LAT_MAX);
  const lon = wrapLon(Number(els.lon.value));
  const z = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  els.lat.value = lat.toFixed(6);
  els.lon.value = lon.toFixed(6);
  els.zoom.value = z;
  saveState();

  const plan = scalePlanResolution(patchPlanForZoom(z), S.resolutionScale);
  const tile = latLonToTile(lat, lon, z);
  setStatus(`주변 타일 로딩: ${plan.width * plan.width}개 (z${z}/${tile.x}/${tile.y} 중심)`);
  els.tileHud.textContent = `z${z}/${tile.x}/${tile.y}`;

  try {
    let committed = false;
    let renderedOnce = false;
    let lastPartialRenderTime = 0;
    let queuedGrid = null;
    let partialTimer = 0;

    const renderLoadedGrid = (grid, renderOptions) => {
      S.currentGrid = grid;
      renderTerrain(grid, renderOptions);
      updatePatchPosition();
      if (viewAnchor && !viewAnchorApplied) {
        preserveGeographicViewAnchor(viewAnchor, z);
        viewAnchorApplied = true;
      }
      updatePlayerMarker({ followCamera: !viewAnchor && !renderOptions.keepCamera });
      updatePlaceLabels();
      fillBboxFromCurrent();
      els.rangeHud.textContent = `${Math.round(grid.min)}m..${Math.round(grid.max)}m`;
      els.resolutionHud.textContent = `${grid.tileSamples}x${grid.tileSamples} / tile`;
      els.coverageHud.textContent = grid.fallbackTiles
        ? `${grid.loadedTiles}/${grid.totalTiles} (${grid.fallbackTiles} fallback)`
        : `${grid.loadedTiles}/${grid.totalTiles}`;
      renderedOnce = true;
      lastPartialRenderTime = performance.now();
    };

    const commitPlan = () => {
      if (committed) return;
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
      committed = true;
    };

    const renderQueuedPartial = () => {
      partialTimer = 0;
      if (version !== S.loadVersion || !queuedGrid || queuedGrid.loadedTiles === 0) return;
      commitPlan();
      renderLoadedGrid(queuedGrid, { keepCamera: true });
      setStatus(`주변 타일 표시 중: ${queuedGrid.loadedTiles}/${queuedGrid.totalTiles}개`);
      queuedGrid = null;
    };

    const handlePartial = (grid) => {
      if (version !== S.loadVersion || grid.loadedTiles === 0) return;
      commitPlan();
      queuedGrid = grid;
      const now = performance.now();
      if (!renderedOnce || now - lastPartialRenderTime >= STREAM_RENDER_THROTTLE_MS) {
        if (partialTimer) {
          window.clearTimeout(partialTimer);
          partialTimer = 0;
        }
        renderLoadedGrid(grid, renderedOnce ? { keepCamera: true } : options);
        setStatus(`주변 타일 표시 중: ${grid.loadedTiles}/${grid.totalTiles}개`);
        queuedGrid = null;
        return;
      }
      if (!partialTimer) {
        partialTimer = window.setTimeout(renderQueuedPartial, STREAM_RENDER_THROTTLE_MS);
      }
    };

    // 중심 타일부터 들어오는 대로 먼저 표시한다.
    const grid = await loadTerrainPatch(tile, z, plan, handlePartial, { signal: abortController.signal });
    if (partialTimer) window.clearTimeout(partialTimer);
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

    commitPlan();
    S.lastGoodZoom = z;
    renderLoadedGrid(grid, renderedOnce ? { keepCamera: true } : options);
    const missingText = grid.missingTiles
      ? `일부 타일 없음: ${grid.missingTiles}/${grid.totalTiles}개. 빈 칸은 평지로 표시됩니다.`
      : `표시 중: ${S.patchWidth}x${S.patchWidth} tiles, samples ${grid.tileSamples} at z${z}/${tile.x}/${tile.y} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
    setStatus(
      !grid.missingTiles && grid.fallbackTiles
        ? `축소 타일 확대 표시: ${grid.fallbackTiles}/${grid.totalTiles}개 fallback at z${z}/${tile.x}/${tile.y}`
        : missingText,
    );

    // 화면이 멈춰 있으면 같은 패치를 더 촘촘히 다시 디코딩해 고해상으로 정밀화한다.
    if (S.loadAbortController === abortController) {
      S.loadAbortController = null;
    }
    scheduleBackfill(tile, z, version);
    scheduleRefine(tile, z, plan, version);
  } catch (error) {
    if (abortController.signal.aborted) return;
    setStatus(`타일 로딩 실패: ${error.message}`);
  } finally {
    if (S.loadAbortController === abortController) {
      S.loadAbortController = null;
    }
  }
}

function scheduleBackfill(tile, z, version) {
  const parentZ = Math.max(MIN_ZOOM, z - BACKFILL_ZOOM_DELTA);
  if (parentZ >= z) return;

  window.setTimeout(async () => {
    if (version !== S.loadVersion) return;
    try {
      const scale = 2 ** (z - parentZ);
      const parentLimit = 2 ** parentZ;
      const parentTile = {
        x: Math.floor(tile.x / scale) % parentLimit,
        y: clamp(Math.floor(tile.y / scale), 0, parentLimit - 1),
        z: parentZ,
      };
      const plan = {
        width: BACKFILL_WIDTH,
        negative: BACKFILL_WIDTH / 2 - 1,
        positive: BACKFILL_WIDTH / 2,
        samples: BACKFILL_TILE_SAMPLES,
        worldSize: BACKFILL_WIDTH * TILE_WORLD * scale,
      };
      const grid = await loadTerrainPatch(parentTile, parentZ, plan);
      if (version !== S.loadVersion || grid.loadedTiles === 0) return;
      S.backfillGrid = grid;
      S.backfillTile = parentTile;
      S.backfillScale = scale;
      renderBackfillTerrain(grid);
      updateBackfillPosition();
      setStatus(`원거리 저해상도 지형 채움: z${parentZ} ${grid.loadedTiles}/${grid.totalTiles}개`);
    } catch {
      /* 원거리 보조 지형은 실패해도 가까운 지형 표시를 유지한다. */
    }
  }, 0);
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
      updatePlayerMarker({ followCamera: false });
      updatePlaceLabels();
      els.resolutionHud.textContent = `${refined.tileSamples}x${refined.tileSamples} / tile (고해상)`;
    } catch {
      /* 정밀화 실패는 무시(기본 해상도 유지) */
    }
  }, REFINE_DELAY_MS);
}

function preserveGeographicViewAnchor(anchor, z) {
  const tileFloat = latLonToTileFloat(anchor.lat, anchor.lon, z);
  const offset = tileOffsetFromOrigin(tileFloat);
  const tileWorld = tileWorldSize();
  const delta = new THREE.Vector3(
    offset.x * tileWorld - S.controls.target.x,
    0,
    offset.y * tileWorld - S.controls.target.z,
  );
  S.controls.target.add(delta);
  S.camera.position.add(delta);
}

// 지형 강조(exaggeration) 변경 시 카메라 유지한 채 메시만 다시 만든다.
export function applyExaggeration() {
  if (!S.currentGrid) return;
  renderTerrain(S.currentGrid, { keepCamera: true });
  if (S.backfillGrid) {
    renderBackfillTerrain(S.backfillGrid);
    updateBackfillPosition();
  }
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
  updateBackfillPosition();
  if (S.tileBoundaryGroup) S.tileBoundaryGroup.position.set(x, 0, z);
  if (S.directionGroup) S.directionGroup.position.set(x, 0, z);
  updatePlaceLabels();
}

function updateBackfillPosition() {
  if (!S.terrainBackfill || !S.backfillTile || !S.worldOriginTileFloat) return;
  const center = {
    x: (S.backfillTile.x + PATCH_CENTER_OFFSET) * S.backfillScale,
    y: (S.backfillTile.y + PATCH_CENTER_OFFSET) * S.backfillScale,
  };
  const offset = tileOffsetFromOrigin(center);
  const tileWorld = tileWorldSize();
  S.terrainBackfill.position.set(offset.x * tileWorld, 0, offset.y * tileWorld);
}

export function updatePlayerMarker(options = {}) {
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
  if (options.followCamera === false) return;
  const desiredTarget = new THREE.Vector3(x, S.playerMarker.position.y, worldZ);
  const cameraFollowDelta = desiredTarget.clone().sub(S.controls.target).multiplyScalar(0.18);
  S.controls.target.add(cameraFollowDelta);
  S.camera.position.add(cameraFollowDelta);
}
