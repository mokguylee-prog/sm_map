// localStorage 영속화: 마지막 위치/줌/소스/강조값 저장·복원.

import { STORAGE_KEY } from "./config.js";
import { els } from "./dom.js";

export function saveState() {
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

export function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
