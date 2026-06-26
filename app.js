import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

import { SOURCES } from "./src/config.js";
import { els, setStatus } from "./src/dom.js";
import { clamp } from "./src/utils.js";
import { saveState, loadState } from "./src/storage.js";
import { onNetStatsChange, getNetStats, formatBytes, persistNetStats, resetNetStats } from "./src/netStats.js";
import { registerTileCacheWorker, tileCacheCount, clearTileCache } from "./src/tileCachePersist.js";
import { downloadBbox } from "./src/download.js";
import { PRESETS } from "./places.js";
import { QuadTile, EARTH_RADIUS, setTileSegments, getTileSegments, onGlobeMeshChange } from "./src/globe/quadTile.js";
import { latLonToWorld, worldToLatLon } from "./src/globe/globeMath.js";
import { initLabels, updateLabels, setLabelScale } from "./src/globe/labels.js";

const BASE_Z = 2;
const HARD_MAX_Z = 14;
const SPLIT_K = 2.2;
const START_DISTANCE = EARTH_RADIUS * 3.0;
const ZOOM_OFFSET = 1.5;
const MAX_TERRAIN_M = 9000;
const GLOBE_STATE_MARKER = "terrain-globe-state-active-v1";
const TILT_MIN = -Math.PI / 2;
const TILT_MAX = Math.PI / 2;
const TILT_STEP = THREE.MathUtils.degToRad(3);

let renderer;
let labelRenderer;
let scene;
let camera;
let controls;
let globeGroup;
let baseMesh;
let viewTilt = 0;
let flyDest = null;
let pointerDownPos = null;
let tiltTimer = 0;
let netDirty = false;
let appliedExag = 1;
let frameCount = 0;

const roots = [];
const pressedKeys = new Set();
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
const raycaster = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
const NORTH = new THREE.Vector3(0, 1, 0);

onNetStatsChange(() => {
  netDirty = true;
});

onGlobeMeshChange(() => {
  updateCoverageHud();
});

async function init() {
  document.body.dataset.appReady = "true";
  const saved = loadState();
  const hasGlobeState = localStorage.getItem(GLOBE_STATE_MARKER) === "true";
  const initial = hasGlobeState && saved
    ? saved
    : { source: "mapterhorn", lat: 37.5665, lon: 126.978, zoom: 4, exaggeration: 0.5, resolution: 100, labelScale: 1 };

  els.source.value = initial.source ?? "mapterhorn";
  els.url.value = initial.url ?? SOURCES[els.source.value] ?? SOURCES.mapterhorn;
  els.lat.value = Number(initial.lat ?? 37.5665).toFixed(6);
  els.lon.value = Number(initial.lon ?? 126.978).toFixed(6);
  els.zoom.value = clamp(Math.round(Number(initial.zoom ?? 7)), BASE_Z, HARD_MAX_Z);
  els.exaggeration.value = clamp(Number(initial.exaggeration ?? 0.5), 0.01, 0.5);
  els.resolution.value = clamp(Math.round(Number(initial.resolution ?? 100)), 50, 200);
  els.labelScale.value = clamp(Number(initial.labelScale ?? 1), 1, 1.8);

  setTileSegments(resolutionToSegments(Number(els.resolution.value)));
  updateResolutionReadout();

  setupScene();
  setCameraFromInputs();
  appliedExag = targetExaggeration(Math.max(1, camera.position.length() - EARTH_RADIUS));

  initLabels(scene);
  setLabelScale(Number(els.labelScale.value));
  buildRoots();
  buildPresets();
  bindEvents();

  updateNetReadout();
  updateCacheStatus();
  window.setInterval(() => {
    updateCacheStatus();
    persistNetStats();
  }, 5000);
  await registerTileCacheWorker();

  animate();
  localStorage.setItem(GLOBE_STATE_MARKER, "true");
  setStatus("지구본 준비 완료. 드래그: 회전, 휠/버튼: 확대 축소, 클릭: 지점 이동");
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "label-layer";
  document.querySelector(".viewport").appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9dbdcc);

  camera = new THREE.PerspectiveCamera(45, 1, 1, EARTH_RADIUS * 10);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.rotateSpeed = 0.22;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.minDistance = EARTH_RADIUS * 1.0008;
  controls.maxDistance = EARTH_RADIUS * 6;

  scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x8fa56e, 1.65));
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const sun = new THREE.DirectionalLight(0xfff1ce, 3.2);
  sun.position.set(1, 0.6, 0.4).normalize().multiplyScalar(EARTH_RADIUS * 5);
  scene.add(sun);

  baseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 0.999, 96, 96),
    new THREE.MeshStandardMaterial({ color: 0x347485, roughness: 1, metalness: 0 }),
  );
  scene.add(baseMesh);

  const atm = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.018, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x5ca7d6, transparent: true, opacity: 0.12, side: THREE.BackSide }),
  );
  scene.add(atm);

  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  window.addEventListener("resize", resize);
  document.addEventListener("fullscreenchange", resize);
  resize();
}

function resize() {
  // 레이아웃 높이를 실제 보이는 창 높이로 고정(100vh는 전체화면에서 표시영역보다 커질 수 있음).
  document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
  const rect = els.canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
}

function buildRoots() {
  for (const root of roots) root.dispose();
  roots.length = 0;
  const n = 2 ** BASE_Z;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      roots.push(new QuadTile(BASE_Z, x, y, globeGroup));
    }
  }
  updateCoverageHud();
}

function resolutionToSegments(pct) {
  return Math.round(48 * (pct / 100));
}

function currentMaxZoom() {
  return els.source.value === "mapterhorn" ? 12 : HARD_MAX_Z;
}

function effectiveZoom() {
  const alt = Math.max(1, camera.position.length() - EARTH_RADIUS);
  return THREE.MathUtils.clamp(Math.log2((2 * Math.PI * EARTH_RADIUS) / alt) + ZOOM_OFFSET, BASE_Z, currentMaxZoom() + 1);
}

function altitudeForZoom(z) {
  const alt = (2 * Math.PI * EARTH_RADIUS) / 2 ** (z - ZOOM_OFFSET);
  return THREE.MathUtils.clamp(alt, controls.minDistance - EARTH_RADIUS, controls.maxDistance - EARTH_RADIUS);
}

function targetExaggeration(alt) {
  const userMax = Math.max(1, Number(els.exaggeration.value) * 120);
  const altitudeFactor = THREE.MathUtils.clamp(1 - alt / (EARTH_RADIUS * 1.5), 0.35, 1);
  return THREE.MathUtils.clamp(userMax * altitudeFactor, 0.5, userMax);
}

function refreshExaggeration(force = false) {
  const alt = Math.max(1, camera.position.length() - EARTH_RADIUS);
  const target = targetExaggeration(alt);
  if (!force && Math.abs(target - appliedExag) <= appliedExag * 0.2) return;
  appliedExag = target;
  for (const root of roots) rebuildSubtree(root);
}

function rebuildSubtree(node) {
  if (node.isLoaded()) node.rebuild(appliedExag);
  if (node.children) for (const child of node.children) rebuildSubtree(child);
}

function getExaggeration() {
  return appliedExag;
}

function setCameraFromInputs() {
  const lat = clamp(Number(els.lat.value), -85, 85);
  const lon = Number(els.lon.value);
  const zoom = clamp(Math.round(Number(els.zoom.value)), BASE_Z, currentMaxZoom());
  const dir = latLonToWorld(lat, lon, 0).normalize();
  camera.position.copy(dir.multiplyScalar(EARTH_RADIUS + altitudeForZoom(zoom)));
  controls.target.set(0, 0, 0);
  controls.update();
}

function flyTo(lat, lon, altitude = Math.max(1, camera.position.length() - EARTH_RADIUS)) {
  const dir = latLonToWorld(clamp(lat, -85, 85), lon, 0).normalize();
  flyDest = dir.multiplyScalar(EARTH_RADIUS + altitude);
}

function buildPresets() {
  els.presetRow.textContent = "";
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.name;
    button.addEventListener("click", () => flyTo(preset.lat, preset.lon, altitudeForZoom(Math.max(BASE_Z, Number(els.zoom.value) || 7))));
    els.presetRow.append(button);
  }
}

function bindEvents() {
  els.menuToggle.addEventListener("click", () => setPanelOpen(!document.body.classList.contains("panel-open")));
  els.chromeToggle.addEventListener("click", () => setChromeCollapsed(!document.body.classList.contains("ui-collapsed")));
  els.panelClose.addEventListener("click", () => setPanelOpen(false));
  els.panelBackdrop.addEventListener("click", () => setPanelOpen(false));

  // 좌상단 표시 토글: 라벨 / 상태바 On·Off.
  const labelToggle = document.querySelector("#labelToggle");
  const statusToggle = document.querySelector("#statusToggle");
  const statusStrip = document.querySelector(".status-strip");
  if (labelToggle) {
    labelToggle.addEventListener("change", () => {
      labelRenderer.domElement.style.display = labelToggle.checked ? "" : "none";
    });
  }
  if (statusToggle && statusStrip) {
    statusToggle.addEventListener("change", () => {
      statusStrip.style.display = statusToggle.checked ? "" : "none";
    });
  }

  els.source.addEventListener("change", () => {
    if (els.source.value !== "custom") els.url.value = SOURCES[els.source.value];
    saveState();
    buildRoots();
  });
  els.url.addEventListener("change", () => {
    saveState();
    buildRoots();
  });

  els.load.addEventListener("click", () => {
    flyDest = null;
    setCameraFromInputs();
    saveState();
  });
  els.locate.addEventListener("click", locate);

  els.exaggeration.addEventListener("input", () => {
    refreshExaggeration(true);
    saveState();
  });
  els.labelScale.addEventListener("input", () => {
    setLabelScale(Number(els.labelScale.value));
  });
  els.labelScale.addEventListener("change", saveState);

  els.resolution.addEventListener("input", updateResolutionReadout);
  els.resolution.addEventListener("change", () => {
    setTileSegments(resolutionToSegments(Number(els.resolution.value)));
    saveState();
    buildRoots();
  });

  els.zoomIn.addEventListener("click", () => zoomByAltitude(0.82));
  els.zoomOut.addEventListener("click", () => zoomByAltitude(1 / 0.82));

  bindTiltButton(els.tiltUp, -TILT_STEP);
  bindTiltButton(els.tiltDown, TILT_STEP);
  els.compass.addEventListener("click", () => {
    viewTilt = 0;
    flyDest = null;
    setCameraFromInputs();
  });

  els.fillBbox.addEventListener("click", fillBboxFromGlobe);
  els.download.addEventListener("click", downloadBbox);
  els.clearCache.addEventListener("click", async () => {
    await clearTileCache();
    await updateCacheStatus();
  });
  els.clearNet.addEventListener("click", () => {
    resetNetStats();
    updateNetReadout();
  });

  renderer.domElement.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomByAltitude(event.deltaY > 0 ? 1.08 : 1 / 1.08, { x: event.clientX, y: event.clientY });
  }, { passive: false });
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setPanelOpen(false);
    if (event.key.startsWith("Arrow") && !(event.target && ["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName))) {
      pressedKeys.add(event.key);
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => pressedKeys.delete(event.key));
  window.addEventListener("blur", () => {
    pressedKeys.clear();
    stopTilt();
  });
}

function bindTiltButton(button, delta) {
  if (!button) return;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    viewTilt = clamp(viewTilt + delta, TILT_MIN, TILT_MAX);
    stopTilt();
    tiltTimer = window.setInterval(() => {
      viewTilt = clamp(viewTilt + delta, TILT_MIN, TILT_MAX);
    }, 33);
  });
  button.addEventListener("pointerup", stopTilt);
  button.addEventListener("pointerleave", stopTilt);
  button.addEventListener("pointercancel", stopTilt);
}

function stopTilt() {
  if (!tiltTimer) return;
  window.clearInterval(tiltTimer);
  tiltTimer = 0;
}

function setPanelOpen(open) {
  document.body.classList.toggle("panel-open", open);
  els.menuToggle.setAttribute("aria-expanded", String(open));
  els.menuToggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
  els.menuToggle.title = open ? "메뉴 닫기" : "메뉴 열기";
}

function setChromeCollapsed(collapsed) {
  document.body.classList.toggle("ui-collapsed", collapsed);
  els.chromeToggle.setAttribute("aria-pressed", String(collapsed));
  els.chromeToggle.setAttribute("aria-label", collapsed ? "화면 오버레이 표시" : "화면 오버레이 숨기기");
  els.chromeToggle.title = collapsed ? "화면 오버레이 표시" : "화면 오버레이 숨기기";
  if (collapsed) setPanelOpen(false);
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  pointerDownPos = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  if (!pointerDownPos) return;
  const moved = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y);
  pointerDownPos = null;
  if (moved > 6) return;

  const hit = pickGlobePointAt(event.clientX, event.clientY);
  if (!hit) return;
  const { lat, lon, r } = worldToLatLon(hit.point);
  const elevation = Math.round((r - EARTH_RADIUS) / Math.max(0.001, appliedExag));
  els.height.textContent = `height_m: ${elevation.toLocaleString()}`;
  els.lat.value = lat.toFixed(6);
  els.lon.value = lon.toFixed(6);
  flyTo(lat, lon);
  saveState();
}

function pickGlobePointAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects([baseMesh, ...globeGroup.children], false)[0] ?? null;
}

function zoomByAltitude(factor, anchor) {
  flyDest = null;
  const alt = camera.position.length() - EARTH_RADIUS;
  const nextAlt = THREE.MathUtils.clamp(alt * factor, controls.minDistance - EARTH_RADIUS, controls.maxDistance - EARTH_RADIUS);
  const currentDir = camera.position.clone().normalize();
  const hit = anchor ? pickGlobePointAt(anchor.x, anchor.y) : null;
  if (hit) {
    const anchorDir = hit.point.clone().normalize();
    const tangent = anchorDir.sub(currentDir.clone().multiplyScalar(anchorDir.dot(currentDir)));
    if (tangent.lengthSq() > 1e-8) {
      tangent.normalize();
      const strength = THREE.MathUtils.clamp(Math.abs(Math.log(factor)) * 0.22, 0, 0.16);
      currentDir.addScaledVector(tangent, factor < 1 ? strength : -strength).normalize();
    }
  }
  camera.position.copy(currentDir.multiplyScalar(EARTH_RADIUS + nextAlt));
  controls.update();
}

function applyKeyRotation() {
  if (!pressedKeys.size) return;
  const angle = 0.012;
  const pos = camera.position;
  const dir = pos.clone().normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, dir).normalize();
  if (pressedKeys.has("ArrowLeft")) pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  if (pressedKeys.has("ArrowRight")) pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
  if (pressedKeys.has("ArrowUp")) pos.applyAxisAngle(right, -angle);
  if (pressedKeys.has("ArrowDown")) pos.applyAxisAngle(right, angle);
  flyDest = null;
}

function locate() {
  if (!navigator.geolocation) {
    setStatus("브라우저 위치 API를 사용할 수 없습니다.");
    return;
  }
  setStatus("현재 위치를 찾는 중...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      flyTo(pos.coords.latitude, pos.coords.longitude, altitudeForZoom(Math.max(8, Number(els.zoom.value) || 8)));
      setStatus(`현재 위치로 이동: ${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`);
    },
    () => setStatus("위치 권한을 받을 수 없습니다."),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  );
}

function fillBboxFromGlobe() {
  const { lat, lon } = worldToLatLon(camera.position);
  const z = clamp(Math.round(effectiveZoom()), BASE_Z, currentMaxZoom());
  const half = (360 / 2 ** z) * 4;
  els.north.value = clamp(lat + half, -85, 85).toFixed(6);
  els.south.value = clamp(lat - half, -85, 85).toFixed(6);
  els.west.value = (lon - half).toFixed(6);
  els.east.value = (lon + half).toFixed(6);
}

function isVisible(node, camPos, camLen) {
  const horizonCos = EARTH_RADIUS / camLen;
  tmpDir.copy(camPos).normalize();
  const dot = node.centerDir.dot(tmpDir);
  const margin = node.boundingRadius / camLen;
  if (dot < horizonCos - margin) return false;
  return frustum.intersectsSphere(node.boundingSphere);
}

function needsSplit(node, camPos) {
  if (node.z >= currentMaxZoom()) return false;
  const distance = camPos.distanceTo(node.center);
  return distance < node.spanMeters * SPLIT_K;
}

function ensureLeaf(node) {
  if (node.state === "idle") node.load(getExaggeration);
  if (node.children) for (const child of node.children) child.setMeshVisible(false);
  node.setMeshVisible(node.isLoaded());
}

function hideSubtree(node) {
  node.setMeshVisible(false);
  node.disposeChildren();
}

function traverse(node, camPos, camLen) {
  if (!isVisible(node, camPos, camLen)) {
    hideSubtree(node);
    return;
  }
  if (needsSplit(node, camPos)) {
    node.ensureChildren();
    let allReady = true;
    for (const child of node.children) {
      if (!child.isLoaded()) {
        if (child.state === "idle") child.load(getExaggeration);
        allReady = false;
      }
    }
    if (allReady) {
      node.setMeshVisible(false);
      for (const child of node.children) traverse(child, camPos, camLen);
    } else {
      ensureLeaf(node);
    }
  } else {
    ensureLeaf(node);
    node.disposeChildren();
  }
}

function animate() {
  requestAnimationFrame(animate);
  applyKeyRotation();
  if (flyDest) {
    camera.position.lerp(flyDest, 0.08);
    if (camera.position.distanceTo(flyDest) < EARTH_RADIUS * 0.002) flyDest = null;
  }
  controls.update();

  const distance = camera.position.length();
  const alt = Math.max(1, distance - EARTH_RADIUS);
  viewTilt = clamp(viewTilt, TILT_MIN, TILT_MAX);
  if (Math.abs(viewTilt) > 0.001) camera.rotateX(-viewTilt);

  controls.rotateSpeed = THREE.MathUtils.clamp((alt / distance) * 0.36, 0.02, 0.24);
  camera.near = Math.max(2, alt * 0.03);
  camera.far = distance + EARTH_RADIUS * 1.5;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);

  const camPos = camera.position;
  const camLen = camPos.length();
  for (const root of roots) traverse(root, camPos, camLen);

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);

  frameCount += 1;
  if (frameCount % 8 === 0) {
    refreshExaggeration(false);
    updateLabels(camera, frustum, effectiveZoom());
    updateHud();
  }
  if (netDirty || frameCount % 15 === 0) {
    netDirty = false;
    updateNetReadout();
  }
  if (frameCount % 40 === 0) {
    saveState();
    persistNetStats();
  }
}

function updateHud() {
  const { lat, lon } = worldToLatLon(camera.position);
  const z = effectiveZoom();
  els.tileHud.textContent = `z${z.toFixed(1)} ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  els.rangeHud.textContent = `고도 ${(Math.max(0, camera.position.length() - EARTH_RADIUS) / 1000).toFixed(1)}km`;
  els.resolutionHud.textContent = `${getTileSegments() + 1}x${getTileSegments() + 1} / tile`;
  if (document.activeElement !== els.lat) els.lat.value = lat.toFixed(6);
  if (document.activeElement !== els.lon) els.lon.value = lon.toFixed(6);
  if (document.activeElement !== els.zoom) els.zoom.value = String(Math.round(z));

  const offset = camera.position.clone();
  const tiltDegrees = Math.round(THREE.MathUtils.radToDeg(viewTilt));
  if (els.tiltAngleReadout) els.tiltAngleReadout.textContent = `${tiltDegrees}\u00b0`;

  if (els.compassNeedle) {
    const dir = offset.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir);
    const sx = NORTH.dot(right);
    const sy = NORTH.dot(up);
    const angle = Math.atan2(sx, sy);
    els.compassNeedle.style.transform = `translateX(-50%) rotate(${angle}rad)`;
  }
}

function countLoaded(node) {
  let loaded = node.isLoaded() ? 1 : 0;
  let total = 1;
  if (node.children) {
    for (const child of node.children) {
      const c = countLoaded(child);
      loaded += c.loaded;
      total += c.total;
    }
  }
  return { loaded, total };
}

function updateCoverageHud() {
  const total = roots.reduce((sum, root) => {
    const c = countLoaded(root);
    sum.loaded += c.loaded;
    sum.total += c.total;
    return sum;
  }, { loaded: 0, total: 0 });
  els.coverageHud.textContent = `${total.loaded}/${total.total}`;
}

function updateResolutionReadout() {
  els.resolutionSliderValue.textContent = `${els.resolution.value}%`;
}

function updateNetReadout() {
  const { receivedBytes, sentBytes, cacheBytes } = getNetStats();
  els.net.textContent = `네트워크 ↓ ${formatBytes(receivedBytes)} · ↑ ${formatBytes(sentBytes)} · 캐시 ${formatBytes(cacheBytes)}`;
}

async function updateCacheStatus() {
  const count = await tileCacheCount();
  els.cacheStatus.textContent = `캐시: ${count.toLocaleString()} 타일`;
}

window.addEventListener("beforeunload", () => {
  saveState();
  persistNetStats();
});
window.addEventListener("pagehide", persistNetStats);

init();
