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
  /**
   * 저장소가 읽을 때만 붙이는 가는 난이도 (직접 정한 값만): 키 `<캐릭터 이름>|<레이드 이름>` → 난이도 이름 또는 `안 감`.
   * 빠진 칸은 자동 기본값 (설계 수정 2026-10-16-friend-first-amendment.md A). saveFriend는 저장하지 않는다.
   */
  targetDifficulty?: Record<string, string>;
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
/**
 * 추천 하나의 한 줄 요약 (웹/디스코드가 같이 쓴다). friendCount = 편성된 친구 수, characterCount = 편성된 캐릭터 수
 * (못 간 캐릭터는 세지 않는다), 외부인은 공대마다 모자란 자리 수의 합. friendThreshold = 이 추천에서 공대마다 필요했던
 * 친구 캐릭터 최소 수 t (설계 수정 2026-10-16-friend-first-amendment.md C).
 */
export interface PlanSummary {
  friendCount: number; characterCount: number; partyCount: number;
  externalCount: number; externalSupports: number; externalDealers: number;
  friendThreshold: number;
  /**
   * "모두 편성" 대안(kind === 'fullPlacement')에만 있는 비교 값 (첫 번째 추천과의 차이; 추천에는 없다):
   * extraExternalVsBest = 이 후보의 외부 인원 총수 − 첫 번째 추천의 외부 인원 총수 (화면: "추천보다 외부 N명 더 필요"),
   * extraPlacedVsBest = 이 후보의 편성된 캐릭터 수 − 첫 번째 추천의 편성된 캐릭터 수 (항상 1 이상).
   */
  extraExternalVsBest?: number;
  extraPlacedVsBest?: number;
}
/** 이번 추천에서 편성되지 못한 후보 캐릭터. */
export interface UnplacedCharacter { friendId: string; characterName: string; }
/**
 * 후보의 종류: 'recommended' = 친구로 꽉 찬 공대 우선 추천 (기준 t 엄격), 'fullPlacement' = "모두 편성" 대안
 * (기준 t를 낮춰 더 많은 캐릭터를 편성한 것; 추천보다 캐릭터를 더 많이 편성할 때만, 결과마다 최대 1개, 항상 마지막).
 */
export type CandidateKind = 'recommended' | 'fullPlacement';
/**
 * 추천 하나 = 완성된 편성 (공대 전부). 같은 친구가 다른 공대에 다른 캐릭터로 들어갈 수 있고
 * (한 공대에는 한 번만), 같은 캐릭터는 추천 안에서 한 번만 나온다. imbalance = 공대별 딜러 평균의 최댓값-최솟값.
 * unplaced = 후보였지만 이 추천에서 편성되지 않은 캐릭터 (참석자 순서, 원정대 순서).
 */
export interface Candidate {
  kind: CandidateKind; parties: Party[]; summary: PlanSummary; imbalance: number; unplaced: UnplacedCharacter[];
}
/**
 * proficiencyTracked: 이 편성의 대상 캐릭터 중 하나라도 이 레이드 숙련도를 직접 정해 두었는가 (반숙 포함).
 * false(또는 없음)면 모두 기본값이라 "숙련자 없음" 경고와 기본 반숙 배지를 보여 주지 않는다. 대상이 없으면 생략.
 */
export interface PlanResult {
  candidates: Candidate[]; excluded: { friendId: string; reason: string }[]; reason?: string; proficiencyTracked?: boolean;
}
