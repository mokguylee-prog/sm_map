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
import { saveState, loadState } from "./src/storage.js";
import { setupThree, updateCompass } from "./src/sceneSetup.js";
import { buildPlaceLabels } from "./src/labels.js";
import { loadTerrain, applyExaggeration } from "./src/terrainLoader.js";
import { onKeyDown, onKeyUp, onTerrainWheel, onPointerMove, updateMovement } from "./src/movement.js";
import { fillBboxFromCurrent, downloadBbox } from "./src/download.js";
import { PRESETS } from "./places.js";

function init() {
  document.body.dataset.appReady = "true";
  const saved = loadState();
  const initial = saved ?? { source: "aws", lat: 37.5665, lon: 126.9780, zoom: 12, exaggeration: 2.5 };

  els.source.value = initial.source ?? "aws";
  els.url.value = initial.url ?? SOURCES[els.source.value] ?? SOURCES.aws;
  els.lat.value = initial.lat;
  els.lon.value = initial.lon;
  els.zoom.value = initial.zoom;
  els.exaggeration.value = initial.exaggeration ?? 2.5;

  setupThree();
  buildPlaceLabels();
  buildPresets();
  bindEvents();
  locateAtStartup(saved);
  animate();
}

function buildPresets() {
  PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.name;
    button.addEventListener("click", () => {
      els.lat.value = preset.lat;
      els.lon.value = preset.lon;
      els.zoom.value = preset.zoom;
      loadTerrain({ resetOrigin: true });
    });
    els.presetRow.append(button);
  });
}

function bindEvents() {
  els.source.addEventListener("change", () => {
    if (els.source.value !== "custom") {
      els.url.value = SOURCES[els.source.value];
    }
    saveState();
  });
  els.load.addEventListener("click", () => loadTerrain({ resetOrigin: true }));
  els.locate.addEventListener("click", () => locate(true));
  els.exaggeration.addEventListener("input", () => {
    applyExaggeration();
    saveState();
  });
  els.fillBbox.addEventListener("click", fillBboxFromCurrent);
  els.download.addEventListener("click", downloadBbox);
  S.renderer.domElement.addEventListener("pointermove", onPointerMove);
  S.renderer.domElement.addEventListener("wheel", onTerrainWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => pressedKeys.clear());
  [els.lat, els.lon, els.zoom, els.url].forEach((el) => {
    el.addEventListener("change", () => {
      saveState();
      loadTerrain({ resetOrigin: true });
    });
  });
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
  S.controls.update();
  updateCompass();
  S.renderer.render(S.scene, S.camera);
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(S.animationFrame);
});

init();
