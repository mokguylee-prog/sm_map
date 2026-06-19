import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import JSZip from "jszip";
import { PLACE_LABELS, PRESETS } from "./places.js";

const TILE_SIZE = 256;
const PATCH_WIDTH = 6;
const PATCH_NEGATIVE = 2;
const PATCH_POSITIVE = PATCH_WIDTH - PATCH_NEGATIVE - 1;
const WORLD_SIZE = 7200;
const MOVE_TILES_PER_SECOND = 0.85;
const RECENTER_THRESHOLD_TILES = 2.25;
const ZOOM_DEBOUNCE_MS = 260;
const MIN_ZOOM = 3;
const MAX_ZOOM = 15;
const STORAGE_KEY = "terrain-webapp-state-v1";
const SOURCES = {
  aws: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  mapterhorn: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
};
const els = {
  canvas: document.querySelector("#terrainCanvas"),
  status: document.querySelector("#statusText"),
  height: document.querySelector("#heightReadout"),
  tileHud: document.querySelector("#tileHud"),
  rangeHud: document.querySelector("#rangeHud"),
  resolutionHud: document.querySelector("#resolutionHud"),
  coverageHud: document.querySelector("#coverageHud"),
  compassNeedle: document.querySelector(".compass .needle"),
  source: document.querySelector("#sourceSelect"),
  url: document.querySelector("#urlTemplate"),
  lat: document.querySelector("#latInput"),
  lon: document.querySelector("#lonInput"),
  zoom: document.querySelector("#zoomInput"),
  exaggeration: document.querySelector("#exaggerationInput"),
  load: document.querySelector("#loadButton"),
  locate: document.querySelector("#locateButton"),
  presetRow: document.querySelector("#presetRow"),
  south: document.querySelector("#southInput"),
  west: document.querySelector("#westInput"),
  north: document.querySelector("#northInput"),
  east: document.querySelector("#eastInput"),
  fillBbox: document.querySelector("#fillBboxButton"),
  download: document.querySelector("#downloadButton"),
  progress: document.querySelector("#progressBar"),
  downloadStatus: document.querySelector("#downloadStatus"),
};

let scene;
let camera;
let renderer;
let controls;
let terrain;
let directionGroup;
let tileBoundaryGroup;
let playerMarker;
let placeLabelGroup;
let currentGrid = null;
let currentTile = null;
let worldOriginTileFloat = null;
let loadVersion = 0;
let lastFrameTime = 0;
let movementDirty = false;
let pendingTileKey = "";
let zoomReloadTimer = 0;
let animationFrame = 0;
const pressedKeys = new Set();
const tileImageDataCache = new Map();

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
  buildPresets();
  bindEvents();
  locateAtStartup(saved);
  animate();
}

function setupThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9dbdcc);

  camera = new THREE.PerspectiveCamera(55, 1, 1, 50000);
  camera.position.set(0, 2200, 2100);

  renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enableZoom = false;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.target.set(0, 0, 0);

  const sun = new THREE.DirectionalLight(0xfff1ce, 3.6);
  sun.position.set(-1200, 1800, 900);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xd9edf4, 0x506245, 2.7));

  const grid = new THREE.GridHelper(WORLD_SIZE, 24, 0x718873, 0x435343);
  grid.position.y = -10;
  scene.add(grid);
  buildTileBoundaries();
  buildDirectionMarkers();
  buildPlayerMarker();
  buildPlaceLabels();

  window.addEventListener("resize", resize);
  resize();
}

function buildPlaceLabels() {
  placeLabelGroup = new THREE.Group();
  PLACE_LABELS.forEach((place) => {
    const sprite = makeTextSprite(place.name, "#ffffff", {
      width: 384,
      height: 128,
      fontSize: place.name.length > 4 ? 46 : 56,
      bg: "rgba(31, 41, 37, 0.76)",
      stroke: "rgba(240, 199, 102, 0.5)",
    });
    sprite.userData.place = place;
    sprite.scale.set(260, 86, 1);
    placeLabelGroup.add(sprite);
  });
  scene.add(placeLabelGroup);
}

function buildPlayerMarker() {
  playerMarker = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.ConeGeometry(44, 130, 4),
    new THREE.MeshStandardMaterial({ color: 0xf0c766, roughness: 0.38, metalness: 0.08 }),
  );
  body.rotation.y = Math.PI * 0.25;
  body.position.y = 90;
  playerMarker.add(body);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(78, 5, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xf0c766, transparent: true, opacity: 0.82 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 18;
  playerMarker.add(ring);

  scene.add(playerMarker);
}

function buildTileBoundaries() {
  tileBoundaryGroup = new THREE.Group();
  const patchWidth = PATCH_WIDTH;
  const tileWorld = WORLD_SIZE / patchWidth;
  const half = WORLD_SIZE / 2;
  const material = new THREE.LineBasicMaterial({
    color: 0xf0c766,
    transparent: true,
    opacity: 0.42,
    depthTest: false,
  });

  for (let i = 1; i < patchWidth; i += 1) {
    const offset = -half + tileWorld * i;
    const vertical = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(offset, 18, -half),
      new THREE.Vector3(offset, 18, half),
    ]);
    const horizontal = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, 18, offset),
      new THREE.Vector3(half, 18, offset),
    ]);
    tileBoundaryGroup.add(new THREE.Line(vertical, material));
    tileBoundaryGroup.add(new THREE.Line(horizontal, material));
  }

  scene.add(tileBoundaryGroup);
}

function buildDirectionMarkers() {
  directionGroup = new THREE.Group();
  const labels = [
    { text: "N", x: 0, z: -WORLD_SIZE * 0.56, color: "#f0c766" },
    { text: "S", x: 0, z: WORLD_SIZE * 0.56, color: "#edf4f1" },
    { text: "E", x: WORLD_SIZE * 0.56, z: 0, color: "#edf4f1" },
    { text: "W", x: -WORLD_SIZE * 0.56, z: 0, color: "#edf4f1" },
  ];

  labels.forEach((label) => {
    const sprite = makeTextSprite(label.text, label.color);
    sprite.position.set(label.x, 90, label.z);
    sprite.scale.set(190, 95, 1);
    directionGroup.add(sprite);
  });

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 80, WORLD_SIZE * 0.42),
    WORLD_SIZE * 0.24,
    0xf0c766,
    130,
    70,
  );
  directionGroup.add(arrow);
  scene.add(directionGroup);
}

function makeTextSprite(text, color, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width ?? 256;
  canvas.height = options.height ?? 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.bg ?? "rgba(21, 27, 25, 0.72)";
  ctx.strokeStyle = options.stroke ?? "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 4;
  roundRect(ctx, 18, 22, canvas.width - 36, canvas.height - 44, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `700 ${options.fontSize ?? 64}px Segoe UI, Malgun Gothic, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  return new THREE.Sprite(material);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
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
    if (currentGrid) renderTerrain(currentGrid, { keepCamera: true });
    saveState();
  });
  els.fillBbox.addEventListener("click", fillBboxFromCurrent);
  els.download.addEventListener("click", downloadBbox);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("wheel", onTerrainWheel, { passive: false });
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

async function loadTerrain(options = {}) {
  const version = ++loadVersion;
  const lat = clamp(Number(els.lat.value), -85, 85);
  const lon = wrapLon(Number(els.lon.value));
  const z = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  els.lat.value = lat.toFixed(6);
  els.lon.value = lon.toFixed(6);
  els.zoom.value = z;
  saveState();

  const tile = latLonToTile(lat, lon, z);
  if (!worldOriginTileFloat || options.resetOrigin || worldOriginTileFloat.z !== z) {
    worldOriginTileFloat = { x: tile.x + 0.5, y: tile.y + 0.5, z };
  }
  currentTile = tile;
  pendingTileKey = tileKey(tile);
  const patchWidth = PATCH_WIDTH;
  setStatus(`주변 타일 로딩: ${patchWidth * patchWidth}개 (z${z}/${tile.x}/${tile.y} 중심)`);
  els.tileHud.textContent = `z${z}/${tile.x}/${tile.y}`;

  try {
    const grid = await loadTerrainPatch(tile, z);
    if (version !== loadVersion) return;
    currentGrid = grid;
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
      : `표시 중: ${patchWidth}x${patchWidth} tiles, samples ${grid.tileSamples} at z${z}/${tile.x}/${tile.y} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
    setStatus(missingText);
  } catch (error) {
    setStatus(`타일 로딩 실패: ${error.message}`);
  }
}

async function loadTerrainPatch(centerTile, z) {
  const patchTiles = [];
  const limit = 2 ** z;
  const tileSamples = samplesForZoom(z);
  for (let oy = -PATCH_NEGATIVE; oy <= PATCH_POSITIVE; oy += 1) {
    for (let ox = -PATCH_NEGATIVE; ox <= PATCH_POSITIVE; ox += 1) {
      patchTiles.push({
        x: (centerTile.x + ox + limit) % limit,
        y: clamp(centerTile.y + oy, 0, limit - 1),
        ox,
        oy,
      });
    }
  }

  const decodedTiles = await Promise.all(
    patchTiles.map(async (tile) => {
      try {
        const imageData = await fetchTileImageData(tile.x, tile.y, z);
        return { ...tile, grid: decodeGrid(imageData, tileSamples), missing: false };
      } catch (error) {
        return { ...tile, grid: emptyGrid(tileSamples), missing: true, error };
      }
    }),
  );

  const tilesWide = PATCH_WIDTH;
  const samples = tileSamples * tilesWide - (tilesWide - 1);
  const heights = new Float32Array(samples * samples);
  const missingTiles = decodedTiles.filter((tile) => tile.missing).length;
  let min = Infinity;
  let max = -Infinity;

  decodedTiles.forEach((tile) => {
    const startX = (tile.ox + PATCH_NEGATIVE) * (tileSamples - 1);
    const startY = (tile.oy + PATCH_NEGATIVE) * (tileSamples - 1);
    for (let y = 0; y < tileSamples; y += 1) {
      for (let x = 0; x < tileSamples; x += 1) {
        const h = tile.grid.heights[y * tileSamples + x];
        const target = (startY + y) * samples + startX + x;
        heights[target] = h;
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }

  return {
    heights,
    samples,
    min,
    max,
    worldSize: WORLD_SIZE,
    tileSamples,
    totalTiles: decodedTiles.length,
    missingTiles,
    loadedTiles: decodedTiles.length - missingTiles,
  };
}

function samplesForZoom(z) {
  if (z <= 5) return 33;
  if (z <= 8) return 49;
  if (z <= 11) return 65;
  if (z <= 13) return 97;
  return 129;
}

async function fetchTileImageData(x, y, z) {
  const url = tileUrl(x, y, z);
  if (tileImageDataCache.has(url)) return tileImageDataCache.get(url);

  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
  const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  tileImageDataCache.set(url, imageData);
  return imageData;
}

function decodeGrid(imageData, samples) {
  const heights = new Float32Array(samples * samples);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < samples; y += 1) {
    for (let x = 0; x < samples; x += 1) {
      const sx = Math.min(TILE_SIZE - 1, Math.round((x / (samples - 1)) * (TILE_SIZE - 1)));
      const sy = Math.min(TILE_SIZE - 1, Math.round((y / (samples - 1)) * (TILE_SIZE - 1)));
      const i = (sy * TILE_SIZE + sx) * 4;
      const h = imageData.data[i] * 256 + imageData.data[i + 1] + imageData.data[i + 2] / 256 - 32768;
      heights[y * samples + x] = h;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return { heights, samples, min, max };
}

function emptyGrid(samples) {
  return {
    heights: new Float32Array(samples * samples),
    samples,
    min: 0,
    max: 0,
  };
}

function renderTerrain(grid, options = {}) {
  if (terrain) {
    terrain.geometry.dispose();
    terrain.material.dispose();
    scene.remove(terrain);
  }

  const size = grid.worldSize ?? WORLD_SIZE;
  const geometry = new THREE.PlaneGeometry(size, size, grid.samples - 1, grid.samples - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = [];
  const exaggeration = Number(els.exaggeration.value);
  const waterLevel = grid.min < -200 ? 0 : Math.max(0, grid.min);

  for (let i = 0; i < positions.count; i += 1) {
    const h = grid.heights[i];
    positions.setY(i, (h - waterLevel) * exaggeration);
    const t = clamp((h - grid.min) / Math.max(1, grid.max - grid.min), 0, 1);
    colors.push(...terrainColor(t, h, grid));
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);
  updatePatchPosition();
  updatePlaceLabels();

  if (!options.keepCamera) {
    const heightRange = Math.round(grid.max - grid.min);
    const player = playerMarker?.position ?? new THREE.Vector3();
    controls.target.set(player.x, Math.max(0, heightRange * 0.35), player.z);
    camera.position.lerp(new THREE.Vector3(player.x, Math.max(1500, heightRange * 1.6), player.z + 2100), 0.55);
  }
}

function terrainColor(t, h, grid) {
  const alpine = grid.max > 1300;
  if (h <= 1) return [0.06, 0.17, 0.27];
  if (t < 0.2) return mix([0.14, 0.33, 0.23], [0.34, 0.49, 0.25], t / 0.2);
  if (t < 0.5) return mix([0.34, 0.49, 0.25], [0.59, 0.48, 0.31], (t - 0.2) / 0.3);
  if (t < 0.78) return mix([0.59, 0.48, 0.31], alpine ? [0.47, 0.43, 0.41] : [0.72, 0.62, 0.41], (t - 0.5) / 0.28);
  return mix(alpine ? [0.47, 0.43, 0.41] : [0.72, 0.62, 0.41], [0.95, 0.96, 0.91], (t - 0.78) / 0.22);
}

function onPointerMove(event) {
  if (!terrain || !currentGrid) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain)[0];
  if (!hit) {
    els.height.textContent = "height_m: -";
    return;
  }
  const height = sampleHeightAtWorld(hit.point.x - terrain.position.x, hit.point.z - terrain.position.z);
  els.height.textContent = `height_m: ${height.toFixed(1)}`;
}

function sampleHeightAtWorld(x, z) {
  const size = currentGrid.worldSize ?? WORLD_SIZE;
  const u = clamp((x + size / 2) / size, 0, 1);
  const v = clamp((z + size / 2) / size, 0, 1);
  const ix = Math.round(u * (currentGrid.samples - 1));
  const iy = Math.round(v * (currentGrid.samples - 1));
  return currentGrid.heights[iy * currentGrid.samples + ix];
}

function onKeyDown(event) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target && ["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName)) return;
  event.preventDefault();
  pressedKeys.add(event.key);
}

function onKeyUp(event) {
  pressedKeys.delete(event.key);
}

function onTerrainWheel(event) {
  event.preventDefault();
  const currentZoom = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  const nextZoom = clamp(currentZoom + (event.deltaY < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === currentZoom) return;

  els.zoom.value = nextZoom;
  setStatus(`줌 변경: z${nextZoom} 주변 타일 준비 중...`);
  window.clearTimeout(zoomReloadTimer);
  zoomReloadTimer = window.setTimeout(() => {
    loadTerrain({ resetOrigin: true, keepCamera: true });
  }, ZOOM_DEBOUNCE_MS);
}

function fillBboxFromCurrent() {
  const lat = Number(els.lat.value);
  const lon = Number(els.lon.value);
  const z = Number(els.zoom.value);
  const span = 360 / 2 ** z;
  els.south.value = clamp(lat - span * 0.8, -85, 85).toFixed(6);
  els.north.value = clamp(lat + span * 0.8, -85, 85).toFixed(6);
  els.west.value = wrapLon(lon - span * 0.8).toFixed(6);
  els.east.value = wrapLon(lon + span * 0.8).toFixed(6);
}

async function downloadBbox() {
  const z = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  const south = Number(els.south.value);
  const west = Number(els.west.value);
  const north = Number(els.north.value);
  const east = Number(els.east.value);
  const tiles = tilesForBbox(south, west, north, east, z);
  if (!tiles.length) {
    els.downloadStatus.textContent = "다운로드할 타일이 없습니다.";
    return;
  }
  if (tiles.length > 800 && !confirm(`${tiles.length}개 타일을 받습니다. 계속할까요?`)) return;

  els.download.disabled = true;
  els.progress.style.width = "0%";
  const zip = new JSZip();
  let done = 0;

  for (const tile of tiles) {
    const response = await fetch(tileUrl(tile.x, tile.y, z), { mode: "cors" });
    if (response.ok) {
      const blob = await response.blob();
      const ext = tileUrl(tile.x, tile.y, z).split(".").pop().split("?")[0] || "png";
      zip.file(`${z}_${tile.x}_${tile.y}.${ext}`, blob);
    }
    done += 1;
    const pct = Math.round((done / tiles.length) * 100);
    els.progress.style.width = `${pct}%`;
    els.downloadStatus.textContent = `${done}/${tiles.length} (${pct}%)`;
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terrain_z${z}_${Date.now()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  els.download.disabled = false;
  els.downloadStatus.textContent = `완료: ${tiles.length}개 타일`;
}

function tilesForBbox(south, west, north, east, z) {
  const nw = latLonToTile(north, west, z);
  const se = latLonToTile(south, east, z);
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);
  const tiles = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function latLonToTile(lat, lon, z) {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
  const n = 2 ** z;
  const x = Math.floor(((wrapLon(lon) + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1), z };
}

function latLonToTileFloat(lat, lon, z) {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
  const n = 2 ** z;
  return {
    x: ((wrapLon(lon) + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

function tileFloatToLatLon(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return {
    lat: (latRad * 180) / Math.PI,
    lon: wrapLon(lon),
  };
}

function tileKey(tile) {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function updateMovement(deltaSeconds) {
  if (!currentTile || !pressedKeys.size) return;

  let forwardAmount = 0;
  let sideAmount = 0;
  if (pressedKeys.has("ArrowUp")) forwardAmount -= 1;
  if (pressedKeys.has("ArrowDown")) forwardAmount += 1;
  if (pressedKeys.has("ArrowRight")) sideAmount += 1;
  if (pressedKeys.has("ArrowLeft")) sideAmount -= 1;
  if (forwardAmount === 0 && sideAmount === 0) return;

  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
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
  movementDirty = true;
  updatePlayerMarker();

  const anchorOffset = tileOffsetFromAnchor(pos, currentTile);
  if (
    Math.abs(anchorOffset.x) > RECENTER_THRESHOLD_TILES ||
    Math.abs(anchorOffset.y) > RECENTER_THRESHOLD_TILES
  ) {
    loadTerrain({ keepCamera: true, resetOrigin: false });
    return;
  }

  setStatus(`이동 중: ${next.lat.toFixed(5)}, ${next.lon.toFixed(5)} (방향키 전후좌우)`);
}

function updatePlayerMarker() {
  if (!playerMarker || !currentTile || !worldOriginTileFloat) return;
  const z = Number(els.zoom.value);
  const pos = latLonToTileFloat(Number(els.lat.value), Number(els.lon.value), z);
  const tileWorld = tileWorldSize();
  const offset = tileOffsetFromOrigin(pos);
  const x = offset.x * tileWorld;
  const worldZ = offset.y * tileWorld;
  const localX = terrain ? x - terrain.position.x : x;
  const localZ = terrain ? worldZ - terrain.position.z : worldZ;
  const h = currentGrid ? sampleHeightAtWorld(localX, localZ) : 0;
  const waterLevel = currentGrid ? (currentGrid.min < -200 ? 0 : Math.max(0, currentGrid.min)) : 0;
  playerMarker.position.set(x, Math.max(28, (h - waterLevel) * Number(els.exaggeration.value) + 42), worldZ);
  const desiredTarget = new THREE.Vector3(x, playerMarker.position.y, worldZ);
  const cameraFollowDelta = desiredTarget.clone().sub(controls.target).multiplyScalar(0.18);
  controls.target.add(cameraFollowDelta);
  camera.position.add(cameraFollowDelta);
}

function updatePlaceLabels() {
  if (!placeLabelGroup || !currentTile || !worldOriginTileFloat) return;
  const z = Number(els.zoom.value);
  const tileWorld = tileWorldSize();
  const half = WORLD_SIZE / 2;
  placeLabelGroup.children.forEach((sprite) => {
    const place = sprite.userData.place;
    const maxZoom = place.maxZoom ?? MAX_ZOOM;
    if (z < place.minZoom || z > maxZoom) {
      sprite.visible = false;
      return;
    }

    const tileFloat = latLonToTileFloat(place.lat, place.lon, z);
    const offset = tileOffsetFromOrigin(tileFloat);
    const x = offset.x * tileWorld;
    const worldZ = offset.y * tileWorld;
    const localX = terrain ? x - terrain.position.x : x;
    const localZ = terrain ? worldZ - terrain.position.z : worldZ;
    const inPatch = localX >= -half && localX <= half && localZ >= -half && localZ <= half;
    if (!inPatch) {
      sprite.visible = false;
      return;
    }

    const h = currentGrid ? sampleHeightAtWorld(localX, localZ) : 0;
    const waterLevel = currentGrid ? (currentGrid.min < -200 ? 0 : Math.max(0, currentGrid.min)) : 0;
    sprite.position.set(x, Math.max(80, (h - waterLevel) * Number(els.exaggeration.value) + 150), worldZ);
    sprite.visible = true;
  });
}

function updatePatchPosition() {
  if (!currentTile || !worldOriginTileFloat) return;
  const center = { x: currentTile.x + 0.5, y: currentTile.y + 0.5 };
  const offset = tileOffsetFromOrigin(center);
  const tileWorld = tileWorldSize();
  const x = offset.x * tileWorld;
  const z = offset.y * tileWorld;
  if (terrain) terrain.position.set(x, 0, z);
  if (tileBoundaryGroup) tileBoundaryGroup.position.set(x, 0, z);
  if (directionGroup) directionGroup.position.set(x, 0, z);
  updatePlaceLabels();
}

function tileOffsetFromAnchor(tileFloat, anchorTile) {
  const limit = 2 ** Number(els.zoom.value);
  let x = tileFloat.x - (anchorTile.x + 0.5);
  if (x > limit / 2) x -= limit;
  if (x < -limit / 2) x += limit;
  return {
    x,
    y: tileFloat.y - (anchorTile.y + 0.5),
  };
}

function tileOffsetFromOrigin(tileFloat) {
  const limit = 2 ** Number(els.zoom.value);
  let x = tileFloat.x - worldOriginTileFloat.x;
  if (x > limit / 2) x -= limit;
  if (x < -limit / 2) x += limit;
  return {
    x,
    y: tileFloat.y - worldOriginTileFloat.y,
  };
}

function tileWorldSize() {
  return WORLD_SIZE / PATCH_WIDTH;
}

function tileUrl(x, y, z) {
  return els.url.value.replaceAll("{z}", z).replaceAll("{x}", x).replaceAll("{y}", y);
}

function resize() {
  const rect = els.canvas.getBoundingClientRect();
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}

function animate() {
  animationFrame = requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSeconds = lastFrameTime ? Math.min(0.08, (now - lastFrameTime) / 1000) : 0;
  lastFrameTime = now;
  updateMovement(deltaSeconds);
  if (movementDirty && !pressedKeys.size) {
    movementDirty = false;
    saveState();
    fillBboxFromCurrent();
  }
  controls.update();
  updateCompass();
  renderer.render(scene, camera);
}

function updateCompass() {
  if (!els.compassNeedle) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  direction.y = 0;
  if (direction.lengthSq() < 0.0001) return;
  direction.normalize();
  const angle = Math.atan2(direction.x, -direction.z);
  els.compassNeedle.style.transform = `translateX(-50%) rotate(${angle}rad)`;
}

function setStatus(message) {
  els.status.textContent = message;
}

function saveState() {
  const state = {
    source: els.source.value,
    url: els.url.value,
    lat: Number(els.lat.value),
    lon: Number(els.lon.value),
    zoom: Number(els.zoom.value),
    exaggeration: Number(els.exaggeration.value),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function mix(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t);
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrame);
});

init();
