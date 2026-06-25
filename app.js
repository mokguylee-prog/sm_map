// 앱 진입점/오케스트레이터.
// 실제 기능은 src/ 하위 모듈로 분리되어 있다:
//   config        상수/설정
//   utils         순수 유틸
//   tileMath      위경도 ↔ 타일 좌표
//   dom           DOM 참조/상태표시
//   state         공유 가변 상태(S)
//   storage       localStorage 저장/복원
//   tiles         타일 fetch(LRU 캐시)/디코딩/패치 조립
//   positioning   타일→월드 오프셋
//   sceneSetup    Three.js 씬/카메라/마커/나침반
//   terrainMesh   높이그리드→3D 메시
//   labels        지명/국가 라벨(지연 생성)
//   terrainLoader 로딩 오케스트레이션
//   movement      입력(마우스/방향키/휠)
//   download      bbox 채우기/ZIP 다운로드

import { SOURCES } from "./src/config.js";
import { els, setStatus } from "./src/dom.js";
import { S, pressedKeys } from "./src/state.js";
import { clamp } from "./src/utils.js";
import { saveState, loadState } from "./src/storage.js";
import { setupThree, updateCompass, resetCameraNorthTopDown, constrainMapPanToPoles } from "./src/sceneSetup.js";
import { applyPlaceLabelScale, buildPlaceLabels } from "./src/labels.js";
import { loadTerrain, applyExaggeration } from "./src/terrainLoader.js";
import {
  onKeyDown,
  onKeyUp,
  onTerrainWheel,
  onPointerMove,
  onPointerDown,
  onPointerUp,
  onClickMove,
  onPinchPointerDown,
  onPinchPointerMove,
  onPinchPointerUp,
  resetPinchPointers,
  updateMovement,
  updateMapPanNavigation,
  zoomTerrainBy,
} from "./src/movement.js";
import { fillBboxFromCurrent, downloadBbox } from "./src/download.js";
import { registerTileCacheWorker, tileCacheCount, clearTileCache } from "./src/tileCachePersist.js";
import { onNetStatsChange, getNetStats, formatBytes, persistNetStats, resetNetStats } from "./src/netStats.js";
import { PRESETS } from "./places.js";

// 통신량 집계는 타일마다 빈번히 갱신되므로, DOM 반영은 프레임당 1회로 코얼레싱한다.
let netDirty = false;
onNetStatsChange(() => {
  netDirty = true;
});

function updateNetReadout() {
  const { receivedBytes, sentBytes, cacheBytes } = getNetStats();
  els.net.textContent =
    `네트워크 ↓ ${formatBytes(receivedBytes)} · ↑ ${formatBytes(sentBytes)} · 캐시 ${formatBytes(cacheBytes)}`;
}

async function init() {
  document.body.dataset.appReady = "true";
  const saved = loadState();
  const initial = saved ?? { source: "mapterhorn", lat: 37.5665, lon: 126.9780, zoom: 12, exaggeration: 0.5 };

  els.source.value = initial.source ?? "mapterhorn";
  els.url.value = initial.url ?? SOURCES[els.source.value] ?? SOURCES.mapterhorn;
  els.lat.value = initial.lat;
  els.lon.value = initial.lon;
  els.zoom.value = initial.zoom;
  els.exaggeration.value = clamp(initial.exaggeration ?? 0.5, 0.01, 0.5);
  els.resolution.value = clamp(Math.round(initial.resolution ?? 100), 50, 200);
  S.resolutionScale = Number(els.resolution.value) / 100;
  updateResolutionReadout();
  els.labelScale.value = clamp(initial.labelScale ?? initial.fontScale ?? 1, 1, 1.8);
  applyLabelScale();

  setupThree();
  buildPlaceLabels();
  buildPresets();
  bindEvents();
  animate();

  // 저장된 누적 통신량을 접속 즉시 표시.
  updateNetReadout();

  // 캐시 타일 수 표시를 주기적으로 갱신(저빈도 폴링) + 누적 통신량 영속화.
  updateCacheStatus();
  window.setInterval(() => {
    updateCacheStatus();
    persistNetStats();
  }, 5000);

  setStatus("타일 캐시 준비 중...");
  await registerTileCacheWorker();
  locateAtStartup(saved);
}

async function updateCacheStatus() {
  const count = await tileCacheCount();
  els.cacheStatus.textContent = `캐시: ${count.toLocaleString()} 타일`;
}

function buildPresets() {
  PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.name;
    button.addEventListener("click", () => {
      // 위치만 이동하고 현재 줌·카메라 뷰는 유지한다(preset.zoom은 적용하지 않음).
      els.lat.value = preset.lat;
      els.lon.value = preset.lon;
      loadTerrain({ keepCamera: true, resetOrigin: true });
    });
    els.presetRow.append(button);
  });
}

function bindEvents() {
  els.menuToggle.addEventListener("click", () => setPanelOpen(true));
  els.panelClose.addEventListener("click", () => setPanelOpen(false));
  els.panelBackdrop.addEventListener("click", () => setPanelOpen(false));
  els.source.addEventListener("change", () => {
    if (els.source.value !== "custom") {
      els.url.value = SOURCES[els.source.value];
    }
    saveState();
    loadTerrain({ keepCamera: true, resetOrigin: true });
  });
  els.load.addEventListener("click", () => loadTerrain({ keepCamera: true, resetOrigin: true }));
  els.locate.addEventListener("click", () => locate(true));
  els.exaggeration.addEventListener("input", () => {
    applyExaggeration();
    saveState();
  });
  els.labelScale.addEventListener("input", applyLabelScale);
  els.labelScale.addEventListener("change", saveState);
  els.fillBbox.addEventListener("click", fillBboxFromCurrent);
  els.download.addEventListener("click", downloadBbox);
  els.clearCache.addEventListener("click", async () => {
    await clearTileCache();
    await updateCacheStatus();
  });
  els.clearNet.addEventListener("click", () => {
    resetNetStats();
    updateNetReadout();
  });
  els.zoomIn.addEventListener("click", () => zoomTerrainBy(1));
  els.zoomOut.addEventListener("click", () => zoomTerrainBy(-1));
  // 드래그 중에는 라벨만 즉시 갱신하고, 손을 떼면(change) 해상도를 적용해 다시 그린다.
  els.resolution.addEventListener("input", () => {
    S.resolutionScale = Number(els.resolution.value) / 100;
    updateResolutionReadout();
  });
  els.resolution.addEventListener("change", () => {
    S.resolutionScale = Number(els.resolution.value) / 100;
    saveState();
    loadTerrain({ keepCamera: true });
  });
  els.compass.addEventListener("click", resetCameraNorthTopDown);
  S.renderer.domElement.addEventListener("pointermove", onPointerMove);
  S.renderer.domElement.addEventListener("pointerdown", onPointerDown);
  S.renderer.domElement.addEventListener("pointerup", onPointerUp);
  S.renderer.domElement.addEventListener("pointercancel", onPointerUp);
  // 모바일 핀치 줌(두 손가락) — OrbitControls 회전 제스처와 함께 동작.
  S.renderer.domElement.addEventListener("pointerdown", onPinchPointerDown);
  S.renderer.domElement.addEventListener("pointermove", onPinchPointerMove);
  S.renderer.domElement.addEventListener("pointerup", onPinchPointerUp);
  S.renderer.domElement.addEventListener("pointercancel", onPinchPointerUp);
  S.renderer.domElement.addEventListener("click", onClickMove);
  S.renderer.domElement.addEventListener("wheel", onTerrainWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setPanelOpen(false);
  });
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("pointerup", onPinchPointerUp);
  window.addEventListener("pointercancel", onPinchPointerUp);
  window.addEventListener("blur", () => {
    pressedKeys.clear();
    resetPinchPointers();
  });
  [els.lat, els.lon, els.zoom, els.url].forEach((el) => {
    el.addEventListener("change", () => {
      saveState();
      loadTerrain({ keepCamera: true, resetOrigin: true });
    });
  });
}

function setPanelOpen(open) {
  document.body.classList.toggle("panel-open", open);
  els.menuToggle.setAttribute("aria-expanded", String(open));
}

function updateResolutionReadout() {
  els.resolutionSliderValue.textContent = `${els.resolution.value}%`;
}

function applyLabelScale() {
  applyPlaceLabelScale(Number(els.labelScale.value));
}

async function locateAtStartup(saved) {
  if (saved) {
    await loadTerrain({ resetOrigin: true });
    return;
  }
  locate(false);
}

function locate(force) {
  if (!navigator.geolocation) {
    setStatus("브라우저 위치 API를 사용할 수 없어 Seoul 프리셋으로 시작합니다.");
    loadTerrain({ resetOrigin: true });
    return;
  }

  setStatus("현재 위치를 찾는 중...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.lat.value = pos.coords.latitude.toFixed(6);
      els.lon.value = pos.coords.longitude.toFixed(6);
      loadTerrain({ resetOrigin: true });
    },
    () => {
      setStatus(force ? "위치 권한을 받을 수 없습니다." : "위치 권한 없음. Seoul 프리셋으로 시작합니다.");
      loadTerrain({ resetOrigin: true });
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  );
}

function animate() {
  S.animationFrame = requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSeconds = S.lastFrameTime ? Math.min(0.08, (now - S.lastFrameTime) / 1000) : 0;
  S.lastFrameTime = now;
  updateMovement(deltaSeconds);
  if (S.movementDirty && !pressedKeys.size) {
    S.movementDirty = false;
    saveState();
    fillBboxFromCurrent();
  }
  if (netDirty) {
    netDirty = false;
    updateNetReadout();
  }
  S.controls.update();
  constrainMapPanToPoles();
  updateMapPanNavigation();
  updateCompass();
  S.renderer.render(S.scene, S.camera);
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(S.animationFrame);
  persistNetStats();
});
// 모바일에서 탭 전환·종료 시 beforeunload가 안 뜰 수 있어 보조로 저장한다.
window.addEventListener("pagehide", persistNetStats);

init();
