# 지형(Terrain) 시스템 문서

게임의 지형 데이터를 어디서 어떻게 받아 높이로 변환하고, 일괄 다운로드·로컬 구동까지
어떻게 다루는지 정리한 문서.

## 목차

- [1. 개요](#1-개요)
- [1-1. 대체 데이터 소스](#1-1-대체-데이터-소스)
- [2. 타일 다운로드 동작](#2-타일-다운로드-동작)
- [3. 타일 데이터 포맷 (고도 디코딩)](#3-타일-데이터-포맷-고도-디코딩)
- [4. 좌표 → 타일 계산](#4-좌표--타일-계산)
- [5. 일괄 다운로드 기능 (Download Terrain)](#5-일괄-다운로드-기능-download-terrain)
- [5-1. 웹앱 프로토타입](#5-1-웹앱-프로토타입)
- [6. 전체 데이터 로컬 구동 (논의, 미구현)](#6-전체-데이터-로컬-구동-논의-미구현)
- [7. 로드맵](#7-로드맵)

---

## 1. 개요

| 항목 | 값 |
| --- | --- |
| 데이터 출처 | **Mapterhorn** |
| 타일 엔드포인트 | `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` |
| 인코딩 | 고도값을 RGB로 인코딩한 webp (**Terrarium** 방식) |
| 로컬 캐시 | `terrain_cache/{z}_{x}_{y}.webp` |
| 커버리지 뷰어 | `https://mapterhorn.com/coverage/` (확인용 뷰어, 다운로드 엔드포인트 아님) |
| 현재 기본 설정 | LOD 12, 렌더 거리 20000 |

---

## 1-1. 대체 데이터 소스

Mapterhorn 외 지구 지형(고도) 데이터 소스. 게임이 **Terrarium 디코딩**
(`R*256 + G + B/256 - 32768`)을 쓰므로, 같은 인코딩이면 **URL만 바꿔 바로 호환**됨.

### A. Terrain-RGB 타일 (게임에 바로 사용 가능)

| 소스 | 엔드포인트 / 형식 | 특징 |
| --- | --- | --- |
| **AWS Open Terrain Tiles** (구 Mapzen) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | **Terrarium 동일 → 거의 드롭인.** 무료·무인증, 전 지구, ~z15. **1순위 대안** |
| **Re:Earth Terrain** | Terrarium + Mapbox 인코딩 제공 | NASADEM·Copernicus GLO-30 융합. Mapzen/deck.gl 호환 |
| **Mapbox Terrain-RGB** | `mapbox.terrain-rgb` (토큰 필요) | 인코딩 **다름**(offset/정밀도) → 디코딩 공식 수정 필요 |
| **MapTiler Terrain-RGB** | 타일 API (키 필요) | Mapbox식 인코딩, 상업용 |

> **추천:** AWS Open Terrain Tiles — Terrarium `.png` 타일이라 "타일 소스 URL 설정화"만 끝나면
> 즉시 전환 가능. PNG라 디코더가 png도 받게 손보면 됨.

### B. 원본 DEM (직접 가공 필요 — 옵션 C 계열)

| 소스 | 해상도 | 비고 |
| --- | --- | --- |
| **Copernicus DEM (GLO-30 / GLO-90)** | 30m / 90m | 전 지구, 무료, 사실상 표준. AWS Open Data 제공 |
| **NASADEM / SRTM** | 30m | 북위 60°~남위 56° 한정, 무료 |
| **ASTER GDEM** | 30m | 전 지구(극지 포함), NASA/일본 |
| **USGS 3DEP** | 1m~10m | 미국 한정 초고해상도 |
| **OpenTopography** | 다양 | 위 DEM을 bbox로 잘라 받는 포털, LiDAR 포함 |
| **각국 LiDAR** | 0.5~1m | 스위스 swissALTI3D, 영국 Defra, 일본 GSI 등 |

→ 이쪽은 `rio-rgbify` 로 Terrain-RGB 타일을 직접 생성해야 함(옵션 C).

**출처:**
[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/),
[Mapzen Terrain Tiles](https://www.mapzen.com/blog/terrain-tile-service/),
[Re:Earth Terrain](https://terrain.reearth.land/)

---

## 2. 타일 다운로드 동작

- 필요한 타일을 **그때그때 온라인에서** 받음.
- 캐시(`terrain_cache/{z}_{x}_{y}.webp`)에 있으면 재사용, 없으면 다운로드.
- 즉, 캐시 폴더만 미리 채워 두면 오프라인 구동도 가능.

---

## 3. 타일 데이터 포맷 (고도 디코딩)

### 열면 뭐가 보이나

- 일반 지도 그림이 **아님**. 붉은/녹/보라 톤의 노이즈처럼 보이는 256px짜리 작은 webp.
- 고도값을 RGB로 인코딩한 데이터라서, 게임이 픽셀을 다시 높이로 디코딩함 (`terrain.rs:320`):

  ```text
  높이(m) = R*256 + G + B/256 - 32768
  ```

- 사람이 보라고 만든 그림이 아니라, 숫자(고도) 텐서를 이미지로 담아둔 것.
- 산악 지역(스위스 등)은 색 변화가 크고, 평지·바다는 거의 균일한 색으로 보임.

### 실제 타일 URL 예시 (z=12)

| 위치 | URL |
| --- | --- |
| Toulon, FR | `https://tiles.mapterhorn.com/12/2115/1503.webp` |
| Zürich, CH | `https://tiles.mapterhorn.com/12/2145/1434.webp` |
| London, UK | `https://tiles.mapterhorn.com/12/2046/1362.webp` |

---

## 4. 좌표 → 타일 계산

줌 `z` 에서 (위도 `lat`, 경도 `long`)에 해당하는 타일 `(x, y)`:

```text
n = 2^z
x = floor( n * (long + 180) / 360 )
y = floor( (1 - ln(tan(lat_rad) + 1/cos(lat_rad)) / π) / 2 * n )   // lat_rad = lat 라디안
```

- 표준 **슬리피(slippy)** 타일 좌표와 동일.
- 줌을 바꾸려면 `z` 만 바꾸면 됨 — `z=14` 면 더 고해상도, 대신 `x·y` 가 4배씩 커짐.

### 참고

- 브라우저에서 404/빈 화면이 뜨면 그 지점은 해당 줌 레벨 커버리지가 없는 것 →
  `https://mapterhorn.com/coverage/` 에서 그 지역의 최대 줌을 확인.
- `z` 를 13, 14로 올려 같은 지점의 더 세밀한 타일도 시험 가능.

---

## 5. 일괄 다운로드 기능 (Download Terrain)

메뉴에서 버튼 하나로 필요한 모든 타일을 미리 받아 캐시에 채우는 기능.

### 구현 위치

#### `src/scenery/terrain.rs`

- `TerrainDownload` 리소스 — 진행 상태 보관
- `all_tiles(locations, lod, render_distance)` — 중복 제거된 타일 목록 계산
- `start_download` — tokio 동시 8개 백그라운드 다운로드

#### `src/ui.rs`

- 위치 목록을 공용 `location_list()` 로 추출 (메뉴·다운로드가 공유)
- 메뉴 좌하단 **"Download Terrain"** 버튼 + 위쪽 진행 바(초록 채움) + 텍스트
  - 진행 중: `Downloading… n/total (%)`
  - 완료: `Terrain ready`

#### 기타

- `update_download_progress` 시스템
- `main.rs` 에 리소스 등록
- `TerrainSettings.max_render_distance` 를 `pub` 으로 공개

### 규모

현재 설정(LOD 12, 렌더 거리 20000)에서 **19개 위치**를 합쳐 약 **300타일**.

## 5-1. 웹앱 프로토타입

`WEBAPP_REQUIREMENTS.md` 기준으로 순수 프론트엔드 웹앱을 추가했다.

- 실행 파일: `index.html`, `styles.css`, `app.js`
- 기본 소스: AWS Open Terrain Tiles Terrarium PNG
- 선택 소스: Mapterhorn WebP, Custom URL 템플릿
- 기능: 현재 위치 시작, 마지막 위치/줌 저장, 주변 6x6 타일 3D 지형 표시,
  고도값 조회, 방향키 전후좌우 이동, bbox 범위 ZIP 다운로드와 진행률 표시
- 화면: 타일 좌표, 고도 범위, 6x6 렌더링 상태를 보여 주는 HUD와 방위표를 포함한다.
- 이동: 방향키를 누르는 동안 현재 위치 마커가 월드 좌표 기준으로 전후좌우 이동한다.
  6x6 지형판 가장자리 쪽으로 접근하면 해당 위치 기준 주변 타일을 자동으로 다시 로딩하고,
  카메라는 커서를 따라간다.
- 클릭 이동(2026-06-20): 왼쪽 클릭 지점으로 관찰자를 이동한다. 레이캐스트 충돌점을
  월드→타일→위경도로 역변환해 위치를 갱신하고 패치를 재로딩한다. 드래그(카메라 회전)와
  구분하기 위해 누른 지점에서 6px 이내로 거의 움직이지 않은 제자리 클릭만 이동으로 처리한다.
  `resetOrigin`으로 재로딩하며 카메라를 리프레임해 **클릭 지점이 화면 중앙**으로 오게 한다.
  (`src/movement.js: onPointerDown/onClickMove`)
- 줌/방위: 마우스 휠은 카메라 거리 대신 타일 줌 값을 변경하고 주변 타일을 다시 로딩한다.
  휠 둔감화를 위해 `WHEEL_ZOOM_COOLDOWN_MS`(=240ms) 쿨다운을 두어 연속 휠/관성 스크롤로
  여러 단계가 한꺼번에 점프하지 않게 한다(한 번에 한 단계). 나침반 바늘은 카메라 회전에 맞춰 갱신.
- 적응형 패치(2026-06-20): 줌 아웃일수록 더 넓은 패치(타일 수↑)를 낮은 해상도(타일당 샘플↓)로
  불러와 지형판 자체를 키운다. 지형판이 화면을 더 넓게 덮어 판 바깥 '여백'을 줄인다.
  타일 한 칸의 월드 크기(`TILE_WORLD`=1200)는 고정이라 폭이 커질수록 지형판도 커진다.
  줌별 계획(폭 × 타일당 샘플): z≥14 = 6×129, z12-13 = 6×97, z9-11 = 8×65,
  z7-8 = 10×49, z5-6 = 12×41, z3-4 = 14×33. (`src/config.js: patchPlanForZoom`)
  폭이 바뀌면 그리드/타일 경계선/방위표 프레임을 재구축한다(`src/sceneSetup.js: rebuildFrame`).
  모든 폭은 짝수 + negative=폭/2−1 이라 패치 중심 오프셋이 항상 1로 유지된다(지명 정렬 보존).
- 타일 누락 표시: 줌/위치에 해당하는 타일이 없거나 로딩 실패하면 HUD의 Coverage에
  로딩된 타일 수를 표시하고, 하단 상태바에 누락 타일 수와 데이터 부재 가능성을 표시한다.
- 지명 표시: API 키 없이 동작하도록 주요 한국 지명과 대전 주변 지명을 코드 내장 목록으로
  관리하고, 현재 6x6 지형판 안에 들어오는 라벨만 3D 지형 위에 표시한다.
  국가 라벨 195개는 `country-labels.js`, 지역/산 지명과 프리셋 데이터는 `places.js`에
  분리하고, `app.js`는 이를 import해서 사용한다.
- 브라우저에서 픽셀을 읽어 고도값을 디코딩해야 하므로 원격 타일 서버의 CORS 허용이 필요하다.

### 검토 결과 (2026-06-20)

**CORS 확인 (둘 다 OK — 순수 프론트엔드로 동작 가능):**

- Mapterhorn: `Access-Control-Allow-Origin: *`
- AWS S3 elevation-tiles-prod: **GET 요청에** `Access-Control-Allow-Origin: *` 반환 (HEAD엔 없음)

**리팩터링 (2026-06-20 완료):** 906줄 단일 `app.js` 를 기능별 ES 모듈로 분리.
공유 가변 상태는 `src/state.js` 의 단일 객체 `S` 로 모음. (순환 import 없음)

- `src/`: config, utils, tileMath, dom, state, storage, tiles, positioning,
  sceneSetup, terrainMesh, labels, terrainLoader, movement, download
- `app.js` 는 진입점/오케스트레이터로 축소.

**개선 항목 처리 결과 (모두 적용 완료):**

- **P1 ✅** `fillBboxFromCurrent` → 실제 6×6 패치 타일 범위(`PATCH_NEGATIVE`~`PATCH_POSITIVE`)를
  lat/lon으로 변환해 bbox 산출. (`src/download.js`)
- **P1 ✅** `index.html` 시작 실패 메시지를 "HTTP 서버로 열라(`python -m http.server`)"로 수정.
  실행 방법은 `README.md` 에 문서화됨(`file://` 불가).
- **P2 ✅** 타일 이미지 캐시를 LRU(상한 `TILE_CACHE_LIMIT`=320)로 교체. (`src/tiles.js`)
- **P2 ✅** bbox 다운로드를 동시 `DOWNLOAD_CONCURRENCY`(=6) 워커 풀로 병렬화. (`src/download.js`)
- **P2 ✅** 라벨 스프라이트를 시작 시 일괄 생성하지 않고, 처음 보일 때 생성·캐시. (`src/labels.js`)
- **P3 ✅** `tilesForBbox` 날짜변경선(west>east) 래핑 처리. (`src/tileMath.js`)
- **P3 ✅** 죽은 코드(`pendingTileKey`/`tileKey`) 제거.
- **P3 ☑** 남북 방향: PlaneGeometry 정점 순서 vs 높이 행우선 정렬 재검토 → 북쪽 데이터가
  북쪽(−Z)에 매핑되어 **뒤집힘 없음** 확인. 타일 가장자리 seam은 인접 픽셀 차이로 미미해 허용.

**버그 수정 — 지명이 실제 좌표를 이탈(축소 시 한국 지명이 일본에 찍힘) (2026-06-20):**

- 원인: 패치가 비대칭(서/북 2칸·동/남 3칸 = 6×6)이라 메시 월드 원점(0,0)은
  `중심타일 + 1`(타일 경계)에 해당하는데, 라벨/마커 원점은 `중심타일 + 0.5`(타일 중심)로
  잡혀 있어 **항상 0.5타일 동·남쪽으로 어긋남**.
- 줌이 낮을수록 0.5타일의 실제 경도폭이 커져 증상 심화: z12 ≈ 5km(무시 가능),
  z5 ≈ 5.6°(서일본), z3 ≈ 22.5°(일본 동쪽 바다).
- 수정: `PATCH_CENTER_OFFSET = PATCH_WIDTH/2 − PATCH_NEGATIVE`(=1) 도입,
  `worldOriginTileFloat` 와 `updatePatchPosition` 의 기준을 패치 기하중심으로 통일.
  (`src/config.js`, `src/terrainLoader.js`)

---

## 6. 전체 데이터 로컬 구동 (논의, 미구현)

전 지구를 무차별 다운로드하는 것은 비현실적 — `z=14` ≈ **2.7억 타일, 수 TB**.
보통은 원하는 지역(bbox)만 받는다.

### 전체 데이터셋 용량 (Mapterhorn, 2026-04 기준)

전체 PMTiles 아카이브 합계 **≈ 9.8 TiB** (원본 소스 14.5 TiB에서 생성).

| 구분 | 줌 | 내용 | 비고 |
| --- | --- | --- | --- |
| 글로벌 `planet.pmtiles` | z0–12 | Copernicus GLO-30 (30m) 전 지구 | 전체 용량의 작은 부분 |
| 지역 고해상도 | z13+ | 유럽 22개국 + 일본·뉴질랜드·캐나다·미국 등 (스위스 swissALTI3D 0.5m 포함) | **9.8 TiB의 대부분** |

- 용량 폭증의 주범은 **z13+ 지역 고해상도** 데이터. 전 지구 z14까지 받으면 수 TB.
- 게임은 현재 **LOD 12** 기준이라 글로벌 `planet.pmtiles`(z0–12)만으로 충분.
  단, Mapterhorn이 글로벌 단독 용량은 별도 공시하지 않음 (전체 9.8 TiB의 극히 일부).
- **전부 받을 필요 없음.** `download.mapterhorn.com` 에서 bbox(원하는 영역)로 **extract** 추출 가능.
  `--dry-run` 플래그로 받기 전에 추출 용량을 먼저 확인할 수 있음.
- 출처:
  [oliverwipfli.ch (2026-04-14)](https://oliverwipfli.ch/mapterhorn-update-2026-04-14/),
  [mapterhorn.com/data-access](https://mapterhorn.com/data-access/)

### 로컬 구동 옵션

| 옵션 | 내용 | 비고 |
| --- | --- | --- |
| **A** | PMTiles 아카이브를 받아 로컬 서빙(`pmtiles serve`/`martin`) 후 게임이 로컬 주소를 보게 | 가장 깔끔 (배포·라이선스 확인 필요) |
| **B** | bbox 범위를 일괄 스크랩 → `terrain_cache` 직접 채우기 (다운로더 스크립트) | |
| **C** | 원본 DEM에서 `rio-rgbify` 로 직접 생성 | 완전 자립 |

### 게임 측 전제

- 타일 URL이 현재 `terrain.rs` 에 하드코딩되어 있음.
- 이를 `settings.json` 설정값으로 빼면 로컬 서버·미러로 전환 가능.
- 캐시 폴더만 미리 채워도 오프라인 구동은 가능.

---

## 7. 로드맵

1. **타일 소스 URL 설정화** — 하드코딩된 URL을 `settings.json` 으로 분리
2. **bbox + 줌 일괄 다운로더** — 지역 범위를 받아 캐시를 채우는 스크립트

> 진행 방향 미정.
