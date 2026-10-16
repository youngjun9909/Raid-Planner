export type Role = 'support' | 'dealer';
export interface Character {
  name: string; className: string; role: Role; itemLevel: number; combatPower: number | null;
  /** 저장소가 읽을 때만 붙이는 표시: 전투력/역할이 수동 입력 값이면 true (저장되지는 않는다). */
  manualCombatPower?: boolean;
  manualRole?: boolean;
}
export interface Friend { id: string; displayName: string; discordUserId?: string; representativeName: string; characters: Character[]; }
export interface RaidConfig { id: string; name: string; difficulty: string; size: 4 | 8; minLevel: number; recommendedCP: { min: number; max: number | null }; }
export interface ClearRecord { characterName: string; raidName: string; difficulty: string; }
export type Tier = 'comfortable' | 'tight' | 'risky' | 'unknown';
export type Slot = { kind: 'friend'; friendId: string; character: Character } | { kind: 'external'; role: Role };
export interface Party { slots: Slot[]; dealerAvgCP: number | null; tier: Tier; }
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
export interface PlanResult { candidates: Candidate[]; excluded: { friendId: string; reason: string }[]; reason?: string; }
