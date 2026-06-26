import { WORLD_COUNTRY_LABELS } from "./country-labels.js";
import { WORLD_CAPITAL_LABELS } from "./capital-labels.js";
import { WORLD_MAJOR_CITY_LABELS } from "./major-cities.js";
import { WORLD_MOUNTAIN_RANGE_LABELS } from "./mountain-ranges.js";
import { WORLD_MOUNTAIN_LABELS } from "./mountains.js";
import { KOREA_CITY_LABELS } from "./korea-cities.js";
import { WORLD_DETAILED_CITY_LABELS } from "./detailed-cities.js";

export const PRESETS = [
  { name: "대전", lat: 36.3504, lon: 127.3845, zoom: 12 },
  { name: "서울", lat: 37.5665, lon: 126.9780, zoom: 12 },
  { name: "툴롱", lat: 43.1242, lon: 5.9280, zoom: 12 },
  { name: "취리히", lat: 47.3769, lon: 8.5417, zoom: 12 },
  { name: "런던", lat: 51.5072, lon: -0.1276, zoom: 12 },
];

export const REGIONAL_PLACE_LABELS = [
  { name: "서울", lat: 37.5665, lon: 126.9780, minZoom: 4 },
  { name: "인천", lat: 37.4563, lon: 126.7052, minZoom: 6 },
  { name: "수원", lat: 37.2636, lon: 127.0286, minZoom: 7 },
  { name: "춘천", lat: 37.8813, lon: 127.7298, minZoom: 7 },
  { name: "강릉", lat: 37.7519, lon: 128.8761, minZoom: 7 },
  { name: "청주", lat: 36.6424, lon: 127.4890, minZoom: 7 },
  { name: "대전", lat: 36.3504, lon: 127.3845, minZoom: 6 },
  { name: "세종", lat: 36.4800, lon: 127.2890, minZoom: 8 },
  { name: "공주", lat: 36.4466, lon: 127.1190, minZoom: 9 },
  { name: "계룡", lat: 36.2746, lon: 127.2486, minZoom: 10 },
  { name: "유성", lat: 36.3622, lon: 127.3562, minZoom: 11 },
  { name: "대덕", lat: 36.3467, lon: 127.4150, minZoom: 11 },
  { name: "식장산", lat: 36.3060, lon: 127.4818, minZoom: 11 },
  { name: "계룡산", lat: 36.3428, lon: 127.2059, minZoom: 10 },
  { name: "보문산", lat: 36.3004, lon: 127.4219, minZoom: 11 },
  { name: "구봉산", lat: 36.2919, lon: 127.3344, minZoom: 11 },
  { name: "계족산", lat: 36.3995, lon: 127.4514, minZoom: 11 },
  { name: "만인산", lat: 36.2134, lon: 127.4607, minZoom: 11 },
  { name: "빈계산", lat: 36.3407, lon: 127.2925, minZoom: 12 },
  { name: "갑하산", lat: 36.3631, lon: 127.2796, minZoom: 12 },
  { name: "장태산", lat: 36.2193, lon: 127.3387, minZoom: 11 },
  { name: "금강", lat: 36.4700, lon: 127.1200, minZoom: 9 },
  { name: "북한산", lat: 37.6586, lon: 126.9770, minZoom: 9 },
  { name: "관악산", lat: 37.4450, lon: 126.9640, minZoom: 10 },
  { name: "도봉산", lat: 37.6983, lon: 127.0151, minZoom: 10 },
  { name: "설악산", lat: 38.1194, lon: 128.4656, minZoom: 7 },
  { name: "오대산", lat: 37.7946, lon: 128.5437, minZoom: 8 },
  { name: "치악산", lat: 37.3650, lon: 128.0504, minZoom: 8 },
  { name: "소백산", lat: 36.9571, lon: 128.4846, minZoom: 8 },
  { name: "월악산", lat: 36.8895, lon: 128.1063, minZoom: 8 },
  { name: "속리산", lat: 36.5432, lon: 127.8706, minZoom: 8 },
  { name: "덕유산", lat: 35.8599, lon: 127.7463, minZoom: 8 },
  { name: "가야산", lat: 35.8235, lon: 128.1207, minZoom: 8 },
  { name: "팔공산", lat: 36.0167, lon: 128.6944, minZoom: 9 },
  { name: "무등산", lat: 35.1341, lon: 126.9888, minZoom: 8 },
  { name: "내장산", lat: 35.4787, lon: 126.8879, minZoom: 8 },
  { name: "월출산", lat: 34.7668, lon: 126.7042, minZoom: 8 },
  { name: "지리산", lat: 35.3369, lon: 127.7306, minZoom: 7 },
  { name: "한라산", lat: 33.3617, lon: 126.5292, minZoom: 7 },
  { name: "전주", lat: 35.8242, lon: 127.1480, minZoom: 7 },
  { name: "광주", lat: 35.1595, lon: 126.8526, minZoom: 6 },
  { name: "대구", lat: 35.8714, lon: 128.6014, minZoom: 6 },
  { name: "울산", lat: 35.5384, lon: 129.3114, minZoom: 7 },
  { name: "부산", lat: 35.1796, lon: 129.0756, minZoom: 6 },
  { name: "창원", lat: 35.2279, lon: 128.6811, minZoom: 7 },
  { name: "울릉도", lat: 37.4844, lon: 130.9057, minZoom: 6 },
  { name: "독도", lat: 37.2411, lon: 131.8649, minZoom: 6 },
  { name: "제주", lat: 33.4996, lon: 126.5312, minZoom: 6 },
];

export const PLACE_LABELS = [
  ...WORLD_COUNTRY_LABELS,
  ...WORLD_MOUNTAIN_RANGE_LABELS,
  ...WORLD_CAPITAL_LABELS,
  ...WORLD_MAJOR_CITY_LABELS,
  ...WORLD_DETAILED_CITY_LABELS,
  ...KOREA_CITY_LABELS,
  ...REGIONAL_PLACE_LABELS,
  // 세계 산 라벨은 고도 표시를 위해 type을 부여(영문 이름 봉우리도 산으로 인식되게).
  ...WORLD_MOUNTAIN_LABELS.map((m) => ({ ...m, type: m.type ?? "mountain" })),
];
