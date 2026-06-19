// 입력 처리: 마우스(고도 조회/휠 줌)와 방향키 이동.

import * as THREE from "three";
import {
  MOVE_TILES_PER_SECOND,
  RECENTER_THRESHOLD_TILES,
  ZOOM_DEBOUNCE_MS,
  WHEEL_ZOOM_COOLDOWN_MS,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./config.js";
import { els, setStatus } from "./dom.js";
import { S, pressedKeys } from "./state.js";
import { clamp } from "./utils.js";
import { latLonToTileFloat, tileFloatToLatLon } from "./tileMath.js";
import { tileOffsetFromAnchor, tileWorldSize } from "./positioning.js";
import { sampleHeightAtWorld } from "./terrainMesh.js";
import { loadTerrain, updatePlayerMarker } from "./terrainLoader.js";

export function onPointerMove(event) {
  if (!S.terrain || !S.currentGrid) return;
  const rect = S.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, S.camera);
  const hit = raycaster.intersectObject(S.terrain)[0];
  if (!hit) {
    els.height.textContent = "height_m: -";
    return;
  }
  const height = sampleHeightAtWorld(hit.point.x - S.terrain.position.x, hit.point.z - S.terrain.position.z);
  els.height.textContent = `height_m: ${height.toFixed(1)}`;
}

// 왼쪽 클릭으로 관찰자 이동. 단, 카메라 회전(드래그)과 구분하기 위해
// 누른 지점에서 거의 움직이지 않은 "제자리 클릭"만 이동으로 처리한다.
let pointerDownX = 0;
let pointerDownY = 0;
let pointerDownButton = -1;
const CLICK_DRAG_TOLERANCE = 6; // px

export function onPointerDown(event) {
  pointerDownX = event.clientX;
  pointerDownY = event.clientY;
  pointerDownButton = event.button;
}

export function onClickMove(event) {
  if (pointerDownButton !== 0) return; // 좌클릭만
  if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > CLICK_DRAG_TOLERANCE) {
    return; // 드래그 → 카메라 회전이므로 이동하지 않음
  }
  if (!S.terrain || !S.currentGrid || !S.worldOriginTileFloat) return;

  const rect = S.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, S.camera);
  const hit = raycaster.intersectObject(S.terrain)[0];
  if (!hit) return;

  // 월드 좌표 → 타일 좌표 → 위/경도. (월드 = (tileFloat − 원점) × tileWorld)
  const z = Number(els.zoom.value);
  const tileWorld = tileWorldSize();
  const tileX = S.worldOriginTileFloat.x + hit.point.x / tileWorld;
  const tileY = S.worldOriginTileFloat.y + hit.point.z / tileWorld;
  const next = tileFloatToLatLon(tileX, tileY, z);

  els.lat.value = clamp(next.lat, -85, 85).toFixed(6);
  els.lon.value = next.lon.toFixed(6);
  setStatus(`이동: ${next.lat.toFixed(5)}, ${next.lon.toFixed(5)} (클릭 지점)`);
  // resetOrigin + 카메라 리프레임으로 클릭 지점을 화면 중앙으로 가져온다.
  loadTerrain({ resetOrigin: true });
}

export function onKeyDown(event) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target && ["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName)) return;
  event.preventDefault();
  pressedKeys.add(event.key);
}

export function onKeyUp(event) {
  pressedKeys.delete(event.key);
}

let lastWheelZoomTime = 0;

export function onTerrainWheel(event) {
  event.preventDefault();
  // 둔감화: 쿨다운 안에 연속으로 들어오는 휠 이벤트(트랙패드/관성 스크롤 등)는 무시.
  const now = performance.now();
  if (now - lastWheelZoomTime < WHEEL_ZOOM_COOLDOWN_MS) return;

  const currentZoom = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  const nextZoom = clamp(currentZoom + (event.deltaY < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === currentZoom) return;

  lastWheelZoomTime = now;
  els.zoom.value = nextZoom;
  setStatus(`줌 변경: z${nextZoom} 주변 타일 준비 중...`);
  window.clearTimeout(S.zoomReloadTimer);
  S.zoomReloadTimer = window.setTimeout(() => {
    loadTerrain({ resetOrigin: true, keepCamera: true });
  }, ZOOM_DEBOUNCE_MS);
}

export function updateMovement(deltaSeconds) {
  if (!S.currentTile || !pressedKeys.size) return;

  let forwardAmount = 0;
  let sideAmount = 0;
  if (pressedKeys.has("ArrowUp")) forwardAmount -= 1;
  if (pressedKeys.has("ArrowDown")) forwardAmount += 1;
  if (pressedKeys.has("ArrowRight")) sideAmount += 1;
  if (pressedKeys.has("ArrowLeft")) sideAmount -= 1;
  if (forwardAmount === 0 && sideAmount === 0) return;

  const cameraDirection = new THREE.Vector3();
  S.camera.getWorldDirection(cameraDirection);
  cameraDirection.y = 0;
  if (cameraDirection.lengthSq() < 0.0001) cameraDirection.set(0, 0, -1);
  cameraDirection.normalize();

  const right = new THREE.Vector3(cameraDirection.z, 0, -cameraDirection.x).normalize();
  const move = cameraDirection.multiplyScalar(forwardAmount).add(right.multiplyScalar(sideAmount));
  if (move.lengthSq() > 1) move.normalize();

  const z = Number(els.zoom.value);
  const pos = latLonToTileFloat(Number(els.lat.value), Number(els.lon.value), z);
  const distance = MOVE_TILES_PER_SECOND * deltaSeconds;
  pos.x -= move.x * distance;
  pos.y -= move.z * distance;
  pos.y = clamp(pos.y, 0, 2 ** z - 1);

  const next = tileFloatToLatLon(pos.x, pos.y, z);
  els.lat.value = clamp(next.lat, -85, 85).toFixed(6);
  els.lon.value = next.lon.toFixed(6);
  S.movementDirty = true;
  updatePlayerMarker();

  const anchorOffset = tileOffsetFromAnchor(pos, S.currentTile);
  if (
    Math.abs(anchorOffset.x) > RECENTER_THRESHOLD_TILES ||
    Math.abs(anchorOffset.y) > RECENTER_THRESHOLD_TILES
  ) {
    loadTerrain({ keepCamera: true, resetOrigin: false });
    return;
  }

  setStatus(`이동 중: ${next.lat.toFixed(5)}, ${next.lon.toFixed(5)} (방향키 전후좌우)`);
}
