// 지구본 지명 라벨 레이어(CSS2D).
// PLACE_LABELS(국가/도시/산 등)를 구면 위 위경도에 배치하고, 현재 줌(카메라 고도 환산)·
// 지평선(near side)·프러스텀으로 걸러 가까운 일부만 표시한다.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { latLonToWorld } from "./globeMath.js";
import { PLACE_LABELS } from "../../places.js";

const MAX_VISIBLE = 90; // 동시 표시 상한(과밀 방지)
const LABEL_ALT = 4000; // 표면에서 살짝 띄움(m)
const BASE_FONT_PX = 12;
// 줌과 무관하게 항상 표시(보이는 면에 있으면 노출). 우선순위도 최상위로.
const ALWAYS_VISIBLE = new Set(["에베레스트산", "울릉도", "독도"]);
const TYPE_PRIORITY = {
  country: 0,
  mountainRange: 1,
  capital: 2,
  majorCity: 3,
  koreaCity: 4,
  regional: 5,
  mountain: 6,
};
const TYPE_CLASS = {
  country: "country",
  mountainRange: "mountain-range",
  capital: "capital",
  majorCity: "major-city",
  koreaCity: "korea-city",
  regional: "regional",
  mountain: "mountain",
};

let labels = [];
let pool = [];
let layer = null;
let fontScale = 1;

export function initLabels(scene) {
  layer = new THREE.Group();
  scene.add(layer);

  labels = PLACE_LABELS.map((p) => {
    const pos = latLonToWorld(p.lat, p.lon, LABEL_ALT);
    return {
      name: p.name,
      type: p.type ?? "place",
      minZoom: p.minZoom ?? 3,
      maxZoom: p.maxZoom ?? 99,
      pos,
      dir: pos.clone().normalize(),
      priority: TYPE_PRIORITY[p.type] ?? 10,
      always: ALWAYS_VISIBLE.has(p.name),
    };
  });

  for (let i = 0; i < MAX_VISIBLE; i += 1) {
    const el = document.createElement("div");
    el.className = "globe-label";
    const obj = new CSS2DObject(el);
    obj.visible = false;
    layer.add(obj);
    pool.push({ obj, el });
  }
}

export function setLabelScale(scale) {
  fontScale = scale;
  const px = `${(BASE_FONT_PX * fontScale).toFixed(1)}px`;
  for (const { el } of pool) el.style.fontSize = px;
}

const camDir = new THREE.Vector3();

// effZoom: 카메라 고도에서 환산한 유효 줌(대략 3~12).
export function updateLabels(camera, frustum, effZoom) {
  if (!layer) return;
  const camLen = camera.position.length();
  camDir.copy(camera.position).normalize();
  const horizonCos = Math.min(0.999, 6371000 / camLen);

  const candidates = [];
  for (const l of labels) {
    if (!l.always && (effZoom < l.minZoom || effZoom > l.maxZoom)) continue;
    const dot = l.dir.dot(camDir);
    if (dot <= horizonCos) continue; // 지평선 너머(뒷면)
    if (!frustum.containsPoint(l.pos)) continue;
    candidates.push({ l, dot });
  }

  // 항상 표시 라벨을 최상위로, 그다음 국가/산맥처럼 낮은 줌에서 의미 있는 라벨, 같은 계층이면 화면 중앙에 가까운 순.
  candidates.sort((a, b) => Number(b.l.always) - Number(a.l.always) || a.l.minZoom - b.l.minZoom || a.l.priority - b.l.priority || b.dot - a.dot);

  const count = Math.min(candidates.length, MAX_VISIBLE);
  for (let i = 0; i < MAX_VISIBLE; i += 1) {
    const slot = pool[i];
    if (i < count) {
      const { l } = candidates[i];
      // 수도는 ★, 산맥/산은 ▲ 접두로 시각 구분.
      const prefix = l.type === "capital" ? "★ " : (l.type === "mountainRange" || l.type === "mountain") ? "▲ " : "";
      const text = prefix + l.name;
      if (slot.el.textContent !== text) slot.el.textContent = text;
      slot.el.className = `globe-label label-${TYPE_CLASS[l.type] ?? "place"}`;
      slot.obj.position.copy(l.pos);
      slot.obj.visible = true;
    } else {
      slot.obj.visible = false;
    }
  }
}
