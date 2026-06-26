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

function terrainLatLonFromPointer(event) {
  if (!S.terrain || !S.currentGrid || !S.worldOriginTileFloat) return null;
  const rect = S.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, S.camera);
  const hit = raycaster.intersectObject(S.terrain)[0];
  if (!hit) return null;

  // 월드 좌표 → 타일 좌표 → 위/경도. (월드 = (tileFloat − 원점) × tileWorld)
  const z = Number(els.zoom.value);
  const tileWorld = tileWorldSize();
  const tileX = S.worldOriginTileFloat.x + hit.point.x / tileWorld;
  const tileY = S.worldOriginTileFloat.y + hit.point.z / tileWorld;
  return tileFloatToLatLon(tileX, tileY, z);
}

export function onPointerMove(event) {
  if (activePointers.size >= 2) {
    S.mapPanPointerDown = false;
    S.mapPanDragging = false;
  }
  if (S.mapPanPointerDown && Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > CLICK_DRAG_TOLERANCE) {
    S.mapPanDragging = true;
  }
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
  // 마우스 왼쪽 드래그만 지형 이동으로 추적한다.
  // 터치 한 손가락 드래그는 OrbitControls의 카메라 회전에 사용한다.
  S.mapPanPointerDown = event.pointerType === "mouse" && event.button === 0;
  S.mapPanDragging = false;
  S.mapPanSettleFrames = 0;
}

export function onPointerUp(event) {
  if (event.button !== 0 && event.type !== "pointercancel") return;
  S.mapPanPointerDown = false;
  if (S.mapPanDragging) S.mapPanSettleFrames = 12;
  S.mapPanDragging = false;
}

export function onClickMove(event) {
  if (performance.now() < suppressClickUntil) return;
  if (pointerDownButton !== 0) return; // 좌클릭만
  if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > CLICK_DRAG_TOLERANCE) {
    return; // 드래그 → 카메라 회전이므로 이동하지 않음
  }
  const next = terrainLatLonFromPointer(event);
  if (!next) return;

  els.lat.value = clamp(next.lat, -85, 85).toFixed(6);
  els.lon.value = next.lon.toFixed(6);
  setStatus(`이동: ${next.lat.toFixed(5)}, ${next.lon.toFixed(5)} (클릭 지점)`);
  // keepCamera: 현재 카메라 뷰(각도·거리)를 그대로 유지한다.
  // resetOrigin으로 클릭 지점이 패치 중심(=카메라가 보던 지점)에 오므로 뷰 리셋 없이 이동된다.
  loadTerrain({ keepCamera: true, resetOrigin: true });
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
  // 화면 중앙(현재 lat/lon) 기준으로만 줌한다. 커서 위치로 재중심하지 않으므로
  // 줌 인/아웃 시 뷰가 옆으로 튀지 않고 제자리에 고정된다.
  changeTerrainZoom(nextZoom, null, " (화면 중앙 기준)");
}

// 모바일 핀치 줌: 두 손가락 사이 거리 변화로 타일 줌을 단계 변경한다.
// (휠과 동일하게 zoomTerrainBy를 호출하며, OrbitControls의 회전 제스처와 공존한다.)
const activePointers = new Map();
let pinchBaselineDist = 0;
let lastPinchZoomTime = 0;
let suppressClickUntil = 0;
let twoFingerGesture = null;
const PINCH_ZOOM_RATIO = 1.08; // 기준 대비 8% 벌어지거나 좁혀지면 1단계 줌
const PINCH_ZOOM_COOLDOWN_MS = 120;
const TWO_FINGER_ROTATE_SPEED = 0.006;
const TWO_FINGER_TILT_SPEED = 0.005;

function pinchPointerDistance() {
  const pts = [...activePointers.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function centroid() {
  const pts = [...activePointers.values()];
  return { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
}

function beginTwoFingerGesture() {
  const ids = [...activePointers.keys()];
  const c = centroid();
  // mode: null(미정) → "zoom"(핀치) | "rotate"(회전/틸트). 한 제스처 동안 하나로 고정해 충돌 방지.
  twoFingerGesture = { ids, mode: null, startDist: pinchPointerDistance(), startCx: c.x, startCy: c.y };
  pinchBaselineDist = pinchPointerDistance();
  updatePreviousTouchPositions();
}

function updatePreviousTouchPositions() {
  for (const point of activePointers.values()) {
    point.prevX = point.x;
    point.prevY = point.y;
  }
}

function applyTwoFingerOrbit() {
  if (!S.camera || !S.controls || !twoFingerGesture) return;
  const pts = twoFingerGesture.ids.map((id) => activePointers.get(id)).filter(Boolean);
  if (pts.length !== 2) return;

  // 회전/틸트는 두 손가락 '중심점(centroid)'의 이동으로 구동한다.
  // (핀치는 거리만 변하고 중심점은 거의 안 움직이므로, 모드 고정과 함께 줌과 섞이지 않는다.)
  const dx = (pts[0].x + pts[1].x) * 0.5 - (pts[0].prevX + pts[1].prevX) * 0.5;
  const dy = (pts[0].y + pts[1].y) * 0.5 - (pts[0].prevY + pts[1].prevY) * 0.5;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;

  const target = S.controls.target;
  const offset = S.camera.position.clone().sub(target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta -= dx * TWO_FINGER_ROTATE_SPEED;
  spherical.phi = clamp(
    spherical.phi + dy * TWO_FINGER_TILT_SPEED,
    S.controls.minPolarAngle ?? 0.01,
    S.controls.maxPolarAngle ?? Math.PI - 0.01,
  );
  spherical.makeSafe();

  offset.setFromSpherical(spherical);
  S.camera.position.copy(target).add(offset);
  S.camera.lookAt(target);
  S.controls.update();
}

export function onPinchPointerDown(event) {
  if (event.pointerType === "mouse") return;
  event.preventDefault();
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    prevX: event.clientX,
    prevY: event.clientY,
  });
  if (activePointers.size === 2) {
    beginTwoFingerGesture();
    suppressClickUntil = performance.now() + 500;
    S.mapPanPointerDown = false;
    S.mapPanDragging = false;
  }
}

export function onPinchPointerMove(event) {
  if (!activePointers.has(event.pointerId)) return;
  event.preventDefault();
  const point = activePointers.get(event.pointerId);
  point.x = event.clientX;
  point.y = event.clientY;
  if (activePointers.size !== 2 || !twoFingerGesture || pinchBaselineDist === 0) {
    point.prevX = point.x;
    point.prevY = point.y;
    return;
  }

  const dist = pinchPointerDistance();
  const c = centroid();

  // 제스처 모드 분류(한 번만): 손가락 간 거리 변화가 크면 핀치=줌, 중심점 이동이 크면 회전/틸트.
  if (!twoFingerGesture.mode) {
    const distDelta = Math.abs(dist - twoFingerGesture.startDist);
    const centroidDelta = Math.hypot(c.x - twoFingerGesture.startCx, c.y - twoFingerGesture.startCy);
    if (distDelta > 12 && distDelta >= centroidDelta) twoFingerGesture.mode = "zoom";
    else if (centroidDelta > 12 && centroidDelta > distDelta) twoFingerGesture.mode = "rotate";
  }

  if (twoFingerGesture.mode === "rotate") {
    applyTwoFingerOrbit();
  } else if (twoFingerGesture.mode === "zoom") {
    const now = performance.now();
    if (now - lastPinchZoomTime >= PINCH_ZOOM_COOLDOWN_MS) {
      const ratio = dist / pinchBaselineDist;
      if (ratio >= PINCH_ZOOM_RATIO) {
        lastPinchZoomTime = now;
        pinchBaselineDist = dist;
        zoomTerrainBy(1);
      } else if (ratio <= 1 / PINCH_ZOOM_RATIO) {
        lastPinchZoomTime = now;
        pinchBaselineDist = dist;
        zoomTerrainBy(-1);
      }
    }
  }

  updatePreviousTouchPositions();
}

export function onPinchPointerUp(event) {
  event.currentTarget?.releasePointerCapture?.(event.pointerId);
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    pinchBaselineDist = 0;
    twoFingerGesture = null;
    suppressClickUntil = performance.now() + 500;
  }
}

export function resetPinchPointers() {
  activePointers.clear();
  pinchBaselineDist = 0;
  twoFingerGesture = null;
}

export function zoomTerrainBy(delta) {
  const currentZoom = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  const nextZoom = clamp(currentZoom + delta, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === currentZoom) return;
  // 버튼 줌은 현재 사용자/마커 위치(els.lat/lon)를 중심으로 유지한다.
  changeTerrainZoom(nextZoom, null, " (사용자 위치 기준)");
}

function changeTerrainZoom(nextZoom, cursorPosition, statusSuffix) {
  const viewAnchor = currentViewAnchorLatLon();
  if (cursorPosition) {
    els.lat.value = clamp(cursorPosition.lat, -85, 85).toFixed(6);
    els.lon.value = cursorPosition.lon.toFixed(6);
  }
  els.zoom.value = nextZoom;
  setStatus(`줌 변경: z${nextZoom} 주변 타일 준비 중${statusSuffix}...`);
  window.clearTimeout(S.zoomReloadTimer);
  S.zoomReloadTimer = window.setTimeout(() => {
    loadTerrain({ resetOrigin: true, keepCamera: true, viewAnchor });
  }, ZOOM_DEBOUNCE_MS);
}

function currentViewAnchorLatLon() {
  if (!S.controls || !S.worldOriginTileFloat) return null;
  const z = S.worldOriginTileFloat.z;
  const limit = 2 ** z;
  const tileWorld = tileWorldSize();
  const rawTileX = S.worldOriginTileFloat.x + S.controls.target.x / tileWorld;
  const tileX = ((rawTileX % limit) + limit) % limit;
  const tileY = clamp(S.worldOriginTileFloat.y + S.controls.target.z / tileWorld, 0, limit);
  return tileFloatToLatLon(tileX, tileY, z);
}

export function updateMapPanNavigation() {
  if ((!S.mapPanDragging && S.mapPanSettleFrames <= 0) || !S.currentTile || !S.worldOriginTileFloat || !S.controls) {
    return;
  }
  if (!S.mapPanDragging) S.mapPanSettleFrames -= 1;

  const z = Number(els.zoom.value);
  const limit = 2 ** z;
  const tileWorld = tileWorldSize();
  const rawTileX = S.worldOriginTileFloat.x + S.controls.target.x / tileWorld;
  const tileX = ((rawTileX % limit) + limit) % limit;
  const tileY = clamp(S.worldOriginTileFloat.y + S.controls.target.z / tileWorld, 0, limit);
  const next = tileFloatToLatLon(tileX, tileY, z);

  els.lat.value = clamp(next.lat, -85, 85).toFixed(6);
  els.lon.value = next.lon.toFixed(6);
  S.movementDirty = true;
  updatePlayerMarker({ followCamera: false });
  setStatus(`이동 중: ${next.lat.toFixed(5)}, ${next.lon.toFixed(5)} (드래그)`);

  const anchorOffset = tileOffsetFromAnchor({ x: tileX, y: tileY }, S.currentTile);
  if (
    Math.abs(anchorOffset.x) <= RECENTER_THRESHOLD_TILES &&
    Math.abs(anchorOffset.y) <= RECENTER_THRESHOLD_TILES
  ) {
    return;
  }

  if (S.panReloadTimer) return;
  S.panReloadTimer = window.setTimeout(() => {
    S.panReloadTimer = 0;
    loadTerrain({ keepCamera: true, resetOrigin: false });
  }, 80);
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
