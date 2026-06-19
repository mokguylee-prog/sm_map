# Terrain Scout

Terrarium RGB elevation tiles를 브라우저에서 받아 3D 지형으로 탐색하는 순수 프론트엔드 웹앱입니다.

![Terrain Scout screenshot](assets/screenshot.png)

## 실행

```powershell
python -m http.server 5173
```

브라우저에서 엽니다.

```text
http://localhost:5173/
```

## 주요 기능

- 현재 위치 또는 프리셋 기준 3D 지형 표시
- AWS Open Terrain Tiles / Mapterhorn / Custom URL 선택
- 현재 위치 주변 6x6 타일 자동 로딩
- 줌 레벨에 따른 지형 메시 해상도 자동 조정
- 방향키 전후좌우 이동과 주변 지형 자동 갱신
- 한글 국가/도시/산 지명 라벨 표시
- 고도값 조회, 방위표, 타일 coverage 표시
- bbox 범위 타일 ZIP 다운로드

## 데이터

- 고도 타일은 Terrarium RGB 방식으로 디코딩합니다.
- 지명 라벨은 API 키 없이 동작하도록 `country-labels.js`와 `places.js`에 내장했습니다.

## 참고

자세한 설계와 요구사항은 `WEBAPP_REQUIREMENTS.md`와 `map/map.md`를 참고하세요.
