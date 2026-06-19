// Three.js 씬/카메라/렌더러/컨트롤 구성과 보조 오브젝트(경계선, 방위 마커,
// 플레이어 마커, 텍스트 스프라이트, 나침반, 리사이즈).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { els } from "./dom.js";
import { S } from "./state.js";
import { roundRect } from "./utils.js";

export function setupThree() {
  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(0x9dbdcc);

  S.camera = new THREE.PerspectiveCamera(55, 1, 1, 50000);
  S.camera.position.set(0, 2200, 2100);

  S.renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true });
  S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  S.renderer.shadowMap.enabled = true;

  S.controls = new OrbitControls(S.camera, S.renderer.domElement);
  S.controls.enableDamping = true;
  S.controls.enableZoom = false; // 휠은 타일 줌 변경에 사용
  S.controls.maxPolarAngle = Math.PI * 0.48;
  S.controls.target.set(0, 0, 0);

  const sun = new THREE.DirectionalLight(0xfff1ce, 3.6);
  sun.position.set(-1200, 1800, 900);
  S.scene.add(sun);
  S.scene.add(new THREE.HemisphereLight(0xd9edf4, 0x506245, 2.7));

  buildFrame(); // 현재 S.worldSize / S.patchWidth 기준 그리드·경계선·방위표
  buildPlayerMarker();

  window.addEventListener("resize", resize);
  resize();
}

// 지형판 크기/패치 폭이 줌에 따라 바뀌면 호출해 프레임을 다시 만든다.
export function rebuildFrame() {
  disposeGroup(S.gridHelper);
  disposeGroup(S.tileBoundaryGroup);
  disposeGroup(S.directionGroup);
  buildFrame();
}

function buildFrame() {
  S.gridHelper = new THREE.GridHelper(S.worldSize, 24, 0x718873, 0x435343);
  S.gridHelper.position.y = -10;
  S.scene.add(S.gridHelper);
  buildTileBoundaries();
  buildDirectionMarkers();
}

function disposeGroup(obj) {
  if (!obj) return;
  S.scene.remove(obj);
  obj.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((m) => {
        m.map?.dispose?.();
        m.dispose?.();
      });
    }
  });
  obj.geometry?.dispose?.();
  obj.material?.dispose?.();
}

export function makeTextSprite(text, color, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width ?? 256;
  canvas.height = options.height ?? 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.bg ?? "rgba(21, 27, 25, 0.72)";
  ctx.strokeStyle = options.stroke ?? "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 4;
  roundRect(ctx, 18, 22, canvas.width - 36, canvas.height - 44, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `700 ${options.fontSize ?? 64}px "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  return new THREE.Sprite(material);
}

function buildTileBoundaries() {
  S.tileBoundaryGroup = new THREE.Group();
  const tileWorld = S.worldSize / S.patchWidth;
  const half = S.worldSize / 2;
  const material = new THREE.LineBasicMaterial({
    color: 0xf0c766,
    transparent: true,
    opacity: 0.42,
    depthTest: false,
  });

  for (let i = 1; i < S.patchWidth; i += 1) {
    const offset = -half + tileWorld * i;
    const vertical = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(offset, 18, -half),
      new THREE.Vector3(offset, 18, half),
    ]);
    const horizontal = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, 18, offset),
      new THREE.Vector3(half, 18, offset),
    ]);
    S.tileBoundaryGroup.add(new THREE.Line(vertical, material));
    S.tileBoundaryGroup.add(new THREE.Line(horizontal, material));
  }

  S.scene.add(S.tileBoundaryGroup);
}

function buildDirectionMarkers() {
  S.directionGroup = new THREE.Group();
  const reach = S.worldSize * 0.56;
  const labels = [
    { text: "N", x: 0, z: -reach, color: "#f0c766" },
    { text: "S", x: 0, z: reach, color: "#edf4f1" },
    { text: "E", x: reach, z: 0, color: "#edf4f1" },
    { text: "W", x: -reach, z: 0, color: "#edf4f1" },
  ];

  labels.forEach((label) => {
    const sprite = makeTextSprite(label.text, label.color);
    sprite.position.set(label.x, 90, label.z);
    sprite.scale.set(190, 95, 1);
    S.directionGroup.add(sprite);
  });

  S.scene.add(S.directionGroup);
}

function buildPlayerMarker() {
  S.playerMarker = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.ConeGeometry(44, 130, 4),
    new THREE.MeshStandardMaterial({ color: 0xf0c766, roughness: 0.38, metalness: 0.08 }),
  );
  body.rotation.y = Math.PI * 0.25;
  body.position.y = 90;
  S.playerMarker.add(body);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(78, 5, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xf0c766, transparent: true, opacity: 0.82 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 18;
  S.playerMarker.add(ring);

  S.scene.add(S.playerMarker);
}

export function resize() {
  const rect = els.canvas.getBoundingClientRect();
  S.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  S.camera.updateProjectionMatrix();
  S.renderer.setSize(rect.width, rect.height, false);
}

export function updateCompass() {
  if (!els.compassNeedle) return;
  const direction = new THREE.Vector3();
  S.camera.getWorldDirection(direction);
  direction.y = 0;
  if (direction.lengthSq() < 0.0001) return;
  direction.normalize();
  const angle = Math.atan2(direction.x, -direction.z);
  els.compassNeedle.style.transform = `translateX(-50%) rotate(${angle}rad)`;
}

// 나침반 클릭 시: 현재 타깃을 기준으로 북쪽 정렬 + 수직 top-down 뷰로 리셋한다.
// 거리(줌감)는 유지한다. 정확히 수직이면 방위가 불안정(짐벌락)하므로 미세하게만 +Z로 기울인다.
export function resetCameraNorthTopDown() {
  if (!S.camera || !S.controls) return;
  const target = S.controls.target;
  const distance = Math.max(1, S.camera.position.distanceTo(target));
  const phi = 0.0001; // 거의 수직(라디안). 화면상 거의 완전한 top-down.
  S.camera.up.set(0, 1, 0);
  // theta=0(+Z 쪽)에서 내려다보면 북쪽(-Z)이 화면 위로 온다.
  S.camera.position.set(
    target.x,
    target.y + distance * Math.cos(phi),
    target.z + distance * Math.sin(phi),
  );
  S.camera.lookAt(target);
  S.controls.update();
}
