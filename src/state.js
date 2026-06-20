// 모듈 간 공유되는 가변 상태 저장소.
// ES 모듈은 import한 바인딩을 재할당할 수 없으므로,
// 재할당이 필요한 값은 모두 이 단일 객체의 프로퍼티로 둔다.

export const S = {
  // Three.js 핵심
  scene: null,
  camera: null,
  renderer: null,
  controls: null,

  // 씬 오브젝트
  terrain: null,
  directionGroup: null,
  tileBoundaryGroup: null,
  gridHelper: null,
  playerMarker: null,
  placeLabelGroup: null,

  // 현재 패치 계획(줌에 따라 동적). 초기값은 z12 기준.
  patchWidth: 6,
  patchNegative: 2,
  patchPositive: 3,
  tileSamples: 97,
  worldSize: 7200,

  // 지형/위치 상태
  currentGrid: null,
  currentTile: null,
  worldOriginTileFloat: null,
  lastGoodZoom: null, // 마지막으로 실제 지형이 렌더된 줌(무커버리지 줌에서 복귀용)

  // 루프/타이밍
  loadVersion: 0,
  lastFrameTime: 0,
  movementDirty: false,
  zoomReloadTimer: 0,
  panReloadTimer: 0,
  refineTimer: 0,
  loadAbortController: null,
  animationFrame: 0,

  // Pointer-driven map pan
  mapPanPointerDown: false,
  mapPanDragging: false,
  mapPanSettleFrames: 0,
};

export const pressedKeys = new Set();
