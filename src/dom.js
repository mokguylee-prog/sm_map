// DOM 요소 참조와 상태 텍스트 헬퍼.

export const els = {
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

export function setStatus(message) {
  els.status.textContent = message;
}
