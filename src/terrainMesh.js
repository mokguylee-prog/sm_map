// 높이 그리드 → 3D 지형 메시 생성/렌더링과 고도 샘플링.

import * as THREE from "three";
import { els } from "./dom.js";
import { S } from "./state.js";
import { clamp, mix } from "./utils.js";

// 지형 메시를 (재)생성한다. 패치 위치/라벨 갱신은 호출자(terrainLoader)가 담당한다.
export function renderTerrain(grid, options = {}) {
  if (S.terrain) {
    S.terrain.geometry.dispose();
    S.terrain.material.dispose();
    S.scene.remove(S.terrain);
  }

  const size = grid.worldSize ?? S.worldSize;
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
  S.terrain = new THREE.Mesh(geometry, material);
  S.terrain.receiveShadow = true;
  S.scene.add(S.terrain);

  if (!options.keepCamera) {
    const heightRange = Math.round(grid.max - grid.min);
    const player = S.playerMarker?.position ?? new THREE.Vector3();
    S.controls.target.set(player.x, Math.max(0, heightRange * 0.35), player.z);
    S.camera.position.lerp(
      new THREE.Vector3(player.x, Math.max(1500, heightRange * 1.6), player.z + 2100),
      0.55,
    );
  }
}

export function terrainColor(t, h, grid) {
  const alpine = grid.max > 1300;
  if (h <= 1) return [0.06, 0.17, 0.27];
  if (t < 0.2) return mix([0.14, 0.33, 0.23], [0.34, 0.49, 0.25], t / 0.2);
  if (t < 0.5) return mix([0.34, 0.49, 0.25], [0.59, 0.48, 0.31], (t - 0.2) / 0.3);
  if (t < 0.78) return mix([0.59, 0.48, 0.31], alpine ? [0.47, 0.43, 0.41] : [0.72, 0.62, 0.41], (t - 0.5) / 0.28);
  return mix(alpine ? [0.47, 0.43, 0.41] : [0.72, 0.62, 0.41], [0.95, 0.96, 0.91], (t - 0.78) / 0.22);
}

export function sampleHeightAtWorld(x, z) {
  const size = S.currentGrid.worldSize ?? S.worldSize;
  const u = clamp((x + size / 2) / size, 0, 1);
  const v = clamp((z + size / 2) / size, 0, 1);
  const ix = Math.round(u * (S.currentGrid.samples - 1));
  const iy = Math.round(v * (S.currentGrid.samples - 1));
  return S.currentGrid.heights[iy * S.currentGrid.samples + ix];
}
