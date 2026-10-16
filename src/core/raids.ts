import type { RaidConfig } from './types';

// 권장 전투력은 딜러 공팟 기준 추정치이며 틀릴 수 있다. 새 레이드가 나오면 이 설정만 고친다.
export const RAIDS: RaidConfig[] = [
  { id: 'mordum-hard', name: '카제로스 3막 (모르둠)', difficulty: '하드', size: 8, minLevel: 1700, recommendedCP: { min: 2000, max: 2300 } },
  { id: 'armoche-normal', name: '카제로스 4막 (아르모체)', difficulty: '노말', size: 8, minLevel: 1700, recommendedCP: { min: 2000, max: 2300 } },
  { id: 'cathedral-1', name: '지평의 성당', difficulty: '1단계', size: 4, minLevel: 1700, recommendedCP: { min: 1900, max: 2200 } },
  { id: 'kazeros-normal', name: '카제로스 종막 (카제로스)', difficulty: '노말', size: 8, minLevel: 1710, recommendedCP: { min: 2200, max: 2500 } },
  { id: 'serka-normal', name: '세르카', difficulty: '노말', size: 4, minLevel: 1710, recommendedCP: { min: 2300, max: 2500 } },
  { id: 'armoche-hard', name: '카제로스 4막 (아르모체)', difficulty: '하드', size: 8, minLevel: 1720, recommendedCP: { min: 3000, max: 3300 } },
  { id: 'cathedral-2', name: '지평의 성당', difficulty: '2단계', size: 4, minLevel: 1720, recommendedCP: { min: 3000, max: 3500 } },
  { id: 'kazeros-hard', name: '카제로스 종막 (카제로스)', difficulty: '하드', size: 8, minLevel: 1730, recommendedCP: { min: 3800, max: 4200 } },
  { id: 'serka-hard', name: '세르카', difficulty: '하드', size: 4, minLevel: 1730, recommendedCP: { min: 3600, max: 4000 } },
  { id: 'serka-nightmare', name: '세르카', difficulty: '나이트메어', size: 4, minLevel: 1740, recommendedCP: { min: 4500, max: 5000 } },
  { id: 'cathedral-3', name: '지평의 성당', difficulty: '3단계', size: 4, minLevel: 1750, recommendedCP: { min: 4500, max: 4800 } },
  { id: 'belgardin-normal', name: '벨가르딘', difficulty: '노말', size: 8, minLevel: 1750, recommendedCP: { min: 4000, max: 4500 } },
  { id: 'belgardin-hard', name: '벨가르딘', difficulty: '하드', size: 8, minLevel: 1770, recommendedCP: { min: 5000, max: 5500 } },
  { id: 'belgardin-nightmare', name: '벨가르딘', difficulty: '나이트메어', size: 8, minLevel: 1780, recommendedCP: { min: 7000, max: null } },
];

/** 가장 낮은 레이드 입장 레벨 (지금 1700). 이보다 낮은 캐릭터는 화면에 보이지 않고 원정대 조회에서도 빠진다. */
export const MIN_RAID_LEVEL = Math.min(...RAIDS.map((r) => r.minLevel));

export function getRaid(id: string): RaidConfig | undefined {
  return RAIDS.find((r) => r.id === id);
}

// 서포터 직업은 이 네 개뿐이다 (사용자 확인 2026-10-16). 예외적인 캐릭터는 웹의 수동 역할 지정으로 바꾼다.
export const SUPPORT_CLASSES: string[] = ['홀리나이트', '도화가', '바드', '발키리'];
