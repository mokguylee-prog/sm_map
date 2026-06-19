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
  playerMarker: null,
  placeLabelGroup: null,

  // 지형/위치 상태
  currentGrid: null,
  currentTile: null,
  worldOriginTileFloat: null,

  // 루프/타이밍
  loadVersion: 0,
  lastFrameTime: 0,
  movementDirty: false,
  zoomReloadTimer: 0,
  animationFrame: 0,
};

export const pressedKeys = new Set();
