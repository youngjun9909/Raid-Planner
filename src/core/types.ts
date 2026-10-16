export type Role = 'support' | 'dealer';
export interface Character {
  name: string; className: string; role: Role; itemLevel: number; combatPower: number | null;
  /** 저장소가 읽을 때만 붙이는 표시: 전투력/역할이 수동 입력 값이면 true (저장되지는 않는다). */
  manualCombatPower?: boolean;
  manualRole?: boolean;
}
/** 숙련도 (캐릭터 × 레이드 이름). 숙련 > 반숙 > 클경. 정하지 않으면 반숙. */
export type Proficiency = '숙련' | '반숙' | '클경';
export interface Friend {
  id: string; displayName: string; discordUserId?: string; representativeName: string; characters: Character[];
  /**
   * 저장소가 읽을 때만 붙이는 숙련도: 키 `<캐릭터 이름>|<레이드 이름>` → 숙련도. 정한 값이 없으면 생략된다
   * (빠진 칸은 기본값 반숙). saveFriend는 이 필드를 저장하지 않는다 (setProficiency로만 바뀐다).
   */
  proficiency?: Record<string, Proficiency>;
}
export interface RaidConfig { id: string; name: string; difficulty: string; size: 4 | 8; minLevel: number; recommendedCP: { min: number; max: number | null }; }
export interface ClearRecord { characterName: string; raidName: string; difficulty: string; }
export type Tier = 'comfortable' | 'tight' | 'risky' | 'unknown';
/** 친구 자리의 proficiency는 이 레이드에서의 숙련도 (편성 계산이 채운다; 없으면 반숙으로 본다). */
export type Slot =
  | { kind: 'friend'; friendId: string; character: Character; proficiency?: Proficiency }
  | { kind: 'external'; role: Role };
/** 공대 하나의 숙련도 요약 (친구 자리만 센다; 외부 자리는 알 수 없어 빠진다). noExpert = 숙련 친구 캐릭터가 없음. */
export interface ProficiencySummary { 숙련: number; 반숙: number; 클경: number; noExpert: boolean; }
export interface Party { slots: Slot[]; dealerAvgCP: number | null; tier: Tier; proficiency?: ProficiencySummary; }
/** 추천 하나의 한 줄 요약 (웹/디스코드가 같이 쓴다). 외부인은 공대마다 모자란 자리 수의 합. */
export interface PlanSummary {
  friendCount: number; characterCount: number; partyCount: number;
  externalCount: number; externalSupports: number; externalDealers: number;
}
/**
 * 추천 하나 = 완성된 편성 (공대 전부). 같은 친구가 다른 공대에 다른 캐릭터로 들어갈 수 있고
 * (한 공대에는 한 번만), 같은 캐릭터는 추천 안에서 한 번만 나온다. imbalance = 공대별 딜러 평균의 최댓값-최솟값.
 */
export interface Candidate { parties: Party[]; summary: PlanSummary; imbalance: number; }
/**
 * proficiencyTracked: 이 편성의 대상 캐릭터 중 하나라도 이 레이드 숙련도를 직접 정해 두었는가 (반숙 포함).
 * false(또는 없음)면 모두 기본값이라 "숙련자 없음" 경고와 기본 반숙 배지를 보여 주지 않는다. 대상이 없으면 생략.
 */
export interface PlanResult {
  candidates: Candidate[]; excluded: { friendId: string; reason: string }[]; reason?: string; proficiencyTracked?: boolean;
}
