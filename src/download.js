// bbox 채우기 + bbox 범위 타일 ZIP 다운로드(병렬).

import JSZip from "jszip";
import { MIN_ZOOM, MAX_ZOOM, PATCH_NEGATIVE, PATCH_POSITIVE, DOWNLOAD_CONCURRENCY } from "./config.js";
import { els } from "./dom.js";
import { clamp } from "./utils.js";
import { latLonToTile, tileFloatToLatLon, tilesForBbox } from "./tileMath.js";
import { tileUrl } from "./tiles.js";

// P1: "현재 화면 기준" = 실제로 보이는 6x6 지형판 타일 범위와 일치시킨다.
// (기존엔 타일 ~2x2 폭만 잡혀 화면과 불일치)
export function fillBboxFromCurrent() {
  const lat = Number(els.lat.value);
  const lon = Number(els.lon.value);
  const z = clamp(Math.round(Number(els.zoom.value)), MIN_ZOOM, MAX_ZOOM);
  const n = 2 ** z;
  const center = latLonToTile(lat, lon, z);

  const minX = center.x - PATCH_NEGATIVE;
  const maxX = center.x + PATCH_POSITIVE;
  const minY = clamp(center.y - PATCH_NEGATIVE, 0, n - 1);
  const maxY = clamp(center.y + PATCH_POSITIVE, 0, n - 1);

  // 타일 경계를 lat/lon으로: NW = (minX, minY) 좌상단, SE = (maxX+1, maxY+1) 우하단.
  const nw = tileFloatToLatLon(minX, minY, z);
  const se = tileFloatToLatLon(maxX + 1, maxY + 1, z);

  els.north.value = clamp(nw.lat, -85, 85).toFixed(6);
  els.south.value = clamp(se.lat, -85, 85).toFixed(6);
  els.west.value = nw.lon.toFixed(6);
  els.east.value = se.lon.toFixed(6);
}

export async function downloadBbox() {
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
  let failed = 0;

  // P2: 동시 DOWNLOAD_CONCURRENCY개 워커로 병렬 다운로드.
  let cursor = 0;
  async function worker() {
    while (cursor < tiles.length) {
      const tile = tiles[cursor];
      cursor += 1;
      const url = tileUrl(tile.x, tile.y, z);
      try {
        const response = await fetch(url, { mode: "cors" });
        if (response.ok) {
          const blob = await response.blob();
          const ext = url.split(".").pop().split("?")[0] || "png";
          zip.file(`${z}_${tile.x}_${tile.y}.${ext}`, blob);
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      done += 1;
      const pct = Math.round((done / tiles.length) * 100);
      els.progress.style.width = `${pct}%`;
      els.downloadStatus.textContent = `${done}/${tiles.length} (${pct}%)`;
    }
  }

  const workers = Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, tiles.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terrain_z${z}_${Date.now()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  els.download.disabled = false;
  els.downloadStatus.textContent = failed
    ? `완료: ${tiles.length - failed}/${tiles.length}개 (실패 ${failed})`
    : `완료: ${tiles.length}개 타일`;
}
