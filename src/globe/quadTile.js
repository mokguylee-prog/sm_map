// 지구본 쿼드트리 타일: 고도 타일을 받아 구면 메시로 만들고, 카메라 거리 기반 LOD로
// 분할/병합한다. 전 지구를 한 번에 올리지 않고, 보이는(프러스텀+지평선) 타일만 스트리밍한다.

import * as THREE from "three";
import { fetchTileImageDataWithFallback, decodeGrid } from "../tiles.js";
import { EARTH_RADIUS, latLonToWorld, tileLat, tileLon, tileSpanMeters, heightColor } from "./globeMath.js";

// 타일당 메시 분할 수(한 변). 16 → 17x17 정점. 해상도 슬라이더로 가변.
let tileSegments = 16;
export function setTileSegments(n) {
  tileSegments = Math.max(12, Math.min(96, Math.round(n)));
}
export function getTileSegments() {
  return tileSegments;
}
// 동시 타일 로딩 상한.
const LOAD_CONCURRENCY = 12;

// 공유 머티리얼(타일마다 만들지 않는다).
const tileMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.78,
  metalness: 0.0,
});

// 단순 동시성 제한 로더 큐.
class LoaderQueue {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.active < this.limit && this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      this.active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          this.active -= 1;
          this._pump();
        });
    }
  }
}

const loader = new LoaderQueue(LOAD_CONCURRENCY);

let _onMeshChange = null;
export function onGlobeMeshChange(cb) {
  _onMeshChange = cb;
}

export class QuadTile {
  constructor(z, x, y, group) {
    this.z = z;
    this.x = x;
    this.y = y;
    this.key = `${z}/${x}/${y}`;
    this.group = group;

    this.north = tileLat(y, z);
    this.south = tileLat(y + 1, z);
    this.west = tileLon(x, z);
    this.east = tileLon(x + 1, z);
    this.midLat = (this.north + this.south) / 2;
    this.midLon = (this.west + this.east) / 2;

    this.center = latLonToWorld(this.midLat, this.midLon, 0);
    this.centerDir = this.center.clone().normalize();
    // 경계 구 반경: 중심에서 코너까지 거리(여유분 포함).
    const corner = latLonToWorld(this.north, this.west, 9000);
    this.boundingRadius = corner.distanceTo(this.center) * 1.15;
    this.boundingSphere = new THREE.Sphere(this.center, this.boundingRadius);
    this.spanMeters = tileSpanMeters(z) * Math.max(0.15, Math.cos((this.midLat * Math.PI) / 180));

    this.state = "idle"; // idle | loading | ready | failed
    this.heights = null; // 디코딩된 고도 그리드(과장 변경 시 재구성용)
    this.mesh = null;
    this.children = null;
    this.lastUsed = 0;
  }

  isLoaded() {
    return this.state === "ready";
  }

  async load(getExaggeration) {
    if (this.state === "loading" || this.state === "ready") return;
    this.state = "loading";
    try {
      const { imageData } = await loader.run(() => fetchTileImageDataWithFallback(this.x, this.y, this.z));
      this.segments = tileSegments; // 로드 시점의 세분도를 노드에 고정
      const n = this.segments + 1;
      const grid = decodeGrid(imageData, n);
      this.heights = grid.heights;
      this.mesh = this._buildMesh(getExaggeration());
      this.group.add(this.mesh);
      this.state = "ready";
      _onMeshChange?.();
    } catch {
      this.state = "failed";
    }
  }

  _buildMesh(exaggeration) {
    const seg = this.segments;
    const n = seg + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const v = new THREE.Vector3();
    for (let j = 0; j <= seg; j += 1) {
      const lat = tileLat(this.y + j / seg, this.z);
      for (let i = 0; i <= seg; i += 1) {
        const lon = tileLon(this.x + i / seg, this.z);
        const idx = j * n + i;
        const h = this.heights[idx];
        latLonToWorld(lat, lon, h * exaggeration, v);
        positions[idx * 3] = v.x;
        positions[idx * 3 + 1] = v.y;
        positions[idx * 3 + 2] = v.z;
        heightColor(h, colors, idx * 3);
      }
    }
    const indices = [];
    for (let j = 0; j < seg; j += 1) {
      for (let i = 0; i < seg; i += 1) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, tileMaterial);
  }

  // 과장값이 바뀌면 네트워크 없이 저장된 고도로 정점만 다시 계산한다.
  rebuild(exaggeration) {
    if (this.state !== "ready" || !this.heights) return;
    const seg = this.segments;
    const n = seg + 1;
    const pos = this.mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let j = 0; j <= seg; j += 1) {
      const lat = tileLat(this.y + j / seg, this.z);
      for (let i = 0; i <= seg; i += 1) {
        const lon = tileLon(this.x + i / seg, this.z);
        const idx = j * n + i;
        latLonToWorld(lat, lon, this.heights[idx] * exaggeration, v);
        pos.setXYZ(idx, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  ensureChildren() {
    if (this.children) return;
    const z = this.z + 1;
    const x = this.x * 2;
    const y = this.y * 2;
    this.children = [
      new QuadTile(z, x, y, this.group),
      new QuadTile(z, x + 1, y, this.group),
      new QuadTile(z, x, y + 1, this.group),
      new QuadTile(z, x + 1, y + 1, this.group),
    ];
  }

  setMeshVisible(visible) {
    if (this.mesh) this.mesh.visible = visible;
  }

  // 자식 포함 메시/지오메트리 해제.
  disposeChildren() {
    if (!this.children) return;
    for (const c of this.children) {
      c.dispose();
    }
    this.children = null;
  }

  dispose() {
    this.disposeChildren();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.heights = null;
    this.state = "idle";
  }
}

export { EARTH_RADIUS };
