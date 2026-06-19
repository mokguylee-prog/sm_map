// 위/경도 ↔ 슬리피(slippy) 타일 좌표 변환과 줌별 샘플 수.

import { clamp, wrapLon } from "./utils.js";

// 줌 레벨에 따른 타일당 지형 메시 샘플 수(해상도 자동 조정).
export function samplesForZoom(z) {
  if (z <= 5) return 33;
  if (z <= 8) return 49;
  if (z <= 11) return 65;
  if (z <= 13) return 97;
  return 129;
}

export function latLonToTile(lat, lon, z) {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
  const n = 2 ** z;
  const x = Math.floor(((wrapLon(lon) + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1), z };
}

export function latLonToTileFloat(lat, lon, z) {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
  const n = 2 ** z;
  return {
    x: ((wrapLon(lon) + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

export function tileFloatToLatLon(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return {
    lat: (latRad * 180) / Math.PI,
    lon: wrapLon(lon),
  };
}

// bbox 안에 들어가는 타일 목록.
// P3: 날짜변경선(서경>동경, 즉 west > east)을 넘는 bbox도 올바르게 순회한다.
export function tilesForBbox(south, west, north, east, z) {
  const n = 2 ** z;
  const nw = latLonToTile(north, west, z);
  const se = latLonToTile(south, east, z);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);

  const tiles = [];
  // x는 경도 방향. 날짜변경선을 넘으면 nw.x > se.x 가 되므로 래핑하며 순회한다.
  let xCount = se.x - nw.x;
  if (xCount < 0) xCount += n; // 래핑
  for (let i = 0; i <= xCount; i += 1) {
    const x = (nw.x + i) % n;
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}
