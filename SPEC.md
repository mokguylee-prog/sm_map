# SPEC — 지형 탐색기 추가 구현 명세 (일괄 구현 대기)

나중에 한꺼번에 구현할 기능들의 명세. 각 항목: 현상/문제 → 원하는 동작 → 구현 노트 → 수용 기준.
관련 배경은 `map/map.md` 5-1 절 참고.

> 성능 배경: 저줌일수록 패치가 큼 — z3–4=14×14(196타일), z5–6=12×12(144), z7–8=10×10(100),
> z9–11=8×8(64), z12+=6×6(36). AWS는 전 줌 200(커버리지 OK)이지만 저줌은 타일 수가 많아 느림.

---

## 1. 점진적 스트리밍 렌더 (도착하는 대로 화면 채우기)

**현상:** 현재 `loadTerrainPatch`는 패치의 모든 타일을 `Promise.all`로 기다린 뒤 한 번에 렌더.
저줌(144~196타일)에선 다 받을 때까지 화면이 비거나 굼뜸.

**원하는 동작:** 타일이 도착하는 대로 **중앙부터** 점진적으로 메시를 채워 그린다. 빈 화면으로
두지 않고, 시간이 지나며 지형이 계속 채워진다. (느린 건 허용)

**구현 노트:**
- `src/tiles.js` `loadTerrainPatch(centerTile, z, plan, onPartial)` 로 확장:
  - 패치 타일을 **중심 거리순(`|ox|+|oy|`)으로 정렬**해 fetch를 중앙부터 큐잉.
  - 공유 `heights`(Float32Array, 초기 0)에 타일 도착 시마다 stitch, min/max·loaded 갱신.
  - 각 타일 settle 시 `onPartial(snapshot())` 호출(snapshot은 현재 heights/min/max/loaded 포함).
- `src/terrainLoader.js` `loadTerrain`:
  - `onPartial`에서 **throttle(~300ms)** 로 `renderTerrain` 재호출(첫 렌더만 `options.keepCamera`
    적용, 이후 partial 렌더는 `keepCamera:true`).
  - **첫 성공 타일이 생긴 뒤에만** 상태 커밋(plan/worldSize/frame/origin/currentTile) + 첫 렌더.
    → 전부-없음(loadedTiles===0)이면 커밋/렌더 안 하고 **이전 지형 유지 + lastGoodZoom 복귀**(기존 로직 유지).
  - 모든 타일 settle 후 **최종 렌더**(keepCamera:true) + `S.lastGoodZoom=z` + `scheduleRefine`.
  - 매 partial 렌더마다 `updatePatchPosition/updatePlayerMarker/updatePlaceLabels`, `coverageHud` 갱신.
- 주의: 전체 메시를 매번 재생성하므로 throttle 필수. (추후 geometry attribute in-place 갱신으로 최적화 여지)

**수용 기준:** 저줌으로 축소해도 화면이 비지 않고 중앙부터 지형이 차오른다. 진행 중 HUD 수신
카운트가 증가한다. 줌/이동 시 진행 중 스트림은 `loadVersion`으로 취소된다.

---

## 2. 데이터 소스 변경 시 즉시 재로딩

**현상:** 패널의 "데이터 소스" 드롭다운을 바꿔도 URL만 바뀌고 화면은 그대로. 다음 로드까지 안 바뀜.

**원하는 동작:** 소스를 바꾸면 **즉시 현재 위치/줌으로 재로딩**되어 새 소스의 타일로 표시.

**구현 노트:**
- `app.js` `bindEvents`의 `els.source` change 핸들러에서 `saveState()` 뒤
  `loadTerrain({ keepCamera: true, resetOrigin: true })` 호출.
- (선택) 소스가 바뀌면 URL 키가 달라 기존 캐시와 충돌 없음 — 별도 캐시 비우기 불필요.

**수용 기준:** 소스 드롭다운 변경 즉시 카메라/줌 유지한 채 새 소스로 다시 그려진다.

---

## 3. 마우스 커서 기준 확대/축소

**현상:** 휠 확대/축소가 화면(패치) 중앙 기준으로 동작. 커서 아래 지점이 유지되지 않음.

**원하는 동작:** 휠 줌 시 **커서가 가리키는 지형 지점이 그대로 커서 아래에 머물도록** 확대/축소.
(일반 지도앱처럼 커서 기준 줌)

**구현 노트:**
- `src/movement.js` `onTerrainWheel`:
  - 줌 변경 전, 커서 위치로 레이캐스트해 **현재 커서 아래 지형의 위/경도**를 구한다
    (`onClickMove`의 월드→타일→위경도 역변환 재사용).
  - 새 줌으로 로드할 때 그 위/경도가 **화면상 커서 위치에 오도록** 한다.
    - 단순화안: 커서 아래 위경도를 새 중심(`els.lat/lon`)으로 삼아 `resetOrigin`(커서 지점이 패치
      중심=화면 중앙 근처로). → 정확히 "커서 고정"은 아니고 "커서 지점이 중앙으로". 1차 구현으로 충분.
    - 정밀안: 줌 후 커서 아래 지점의 화면 좌표가 줌 전과 같도록 카메라 타깃을 보정(pan). OrbitControls
      타깃/카메라를 동일 델타로 이동. (구현 복잡, 2차)
  - `keepCamera: true`로 카메라 각도·거리 유지.
- 커서가 지형 밖(하늘)이면 기존 중앙 기준 줌으로 폴백.

**수용 기준:** 지형 위에서 휠을 굴리면 커서가 가리키던 지점이 확대/축소 후에도 (거의) 같은
화면 위치에 남는다.

---

## 4. (연계) z12 여백 — 2단 LOD 배경판 (D안, map.md 로드맵)

저줌에서 큰 패치 대신, **저해상 배경판 + 고해상 중앙판** 2단 LOD로 여백을 없애는 방안.
정합: 배경판 타일 월드크기 = `TILE_WORLD × 2^(z−z_bg)`. 자세한 내용은 `map/map.md` 7절.
1번(스트리밍)·저줌 패치 축소와 함께 설계하면 저줌 성능/여백을 동시에 개선 가능.

---

## 구현 순서 제안

1 → 2 → 3 순으로(스트리밍이 저줌 체감을 가장 크게 개선). 4는 별도 큰 작업이라 마지막/선택.
