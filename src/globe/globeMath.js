// 지구본(범위 B) 공용 수학: 구면 좌표 변환, 타일 경계 위경도, 전 지구 고도 색상 램프.
//
// 메르카토르 평면이 아니라 정점을 실제 위경도로 구면(ECEF 유사)에 직접 배치하므로
// 메르카토르 가로 왜곡이 원리적으로 사라진다(map.md 4-1 참조).

import * as THREE from "three";

// 지구 반지름(구 근사, m). WGS84 타원체 대신 단순 구를 쓴다.
export const EARTH_RADIUS = 6371000;

const DEG2RAD = Math.PI / 180;

// 위경도(도) + 고도(m) → three.js 월드 좌표(Y-up, 경도 동쪽이 +).
export function latLonToWorld(latDeg, lonDeg, height, target = new THREE.Vector3()) {
  const phi = latDeg * DEG2RAD;
  const lambda = lonDeg * DEG2RAD;
  const r = EARTH_RADIUS + height;
  const cosPhi = Math.cos(phi);
  target.set(
    r * cosPhi * Math.cos(lambda),
    r * Math.sin(phi),
    -r * cosPhi * Math.sin(lambda),
  );
  return target;
}

// 월드 좌표 → 위경도(도) + 반지름. latLonToWorld의 역변환.
export function worldToLatLon(vec) {
  const r = vec.length();
  const lat = (Math.asin(THREE.MathUtils.clamp(vec.y / r, -1, 1)) * 180) / Math.PI;
  const lon = (Math.atan2(-vec.z, vec.x) * 180) / Math.PI;
  return { lat, lon, r };
}

// 슬리피 타일 경계의 위경도(래핑 없음 — 타일 메시 경계 계산용).
export function tileLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

export function tileLat(y, z) {
  const n = 2 ** z;
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
}

// 타일 z에서 적도 기준 한 타일이 덮는 지표 거리(m). LOD 분할 판단에 쓴다.
export function tileSpanMeters(z) {
  return (2 * Math.PI * EARTH_RADIUS) / 2 ** z;
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function liftColor(rgb) {
  return [
    Math.min(1, rgb[0] * 1.16 + 0.035),
    Math.min(1, rgb[1] * 1.14 + 0.035),
    Math.min(1, rgb[2] * 1.10 + 0.035),
  ];
}

// 전 지구에서 일관된 절대 고도 색상 램프(타일별 정규화가 아니라 절대값 기준).
// 해수면 이하는 깊이에 따른 파랑, 육지는 녹→갈→회→설(고도).
export function heightColor(h, out, offset) {
  let rgb;
  if (h <= 0) {
    const t = Math.min(1, -h / 6000); // 0 ~ -6000m
    rgb = lerp3([0.16, 0.38, 0.52], [0.06, 0.18, 0.32], t);
  } else if (h < 600) {
    rgb = lerp3([0.38, 0.62, 0.36], [0.72, 0.84, 0.48], h / 600);
  } else if (h < 1800) {
    rgb = lerp3([0.72, 0.84, 0.48], [0.90, 0.78, 0.50], (h - 600) / 1200);
  } else if (h < 3500) {
    rgb = lerp3([0.90, 0.78, 0.50], [0.76, 0.72, 0.66], (h - 1800) / 1700);
  } else {
    rgb = lerp3([0.76, 0.72, 0.66], [1.00, 1.00, 0.96], Math.min(1, (h - 3500) / 2500));
  }
  rgb = liftColor(rgb);
  out[offset] = rgb[0];
  out[offset + 1] = rgb[1];
  out[offset + 2] = rgb[2];
}
