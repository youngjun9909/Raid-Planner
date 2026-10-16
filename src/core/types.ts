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
export interface Candidate { label: string; parties: Party[]; externalCount: number; imbalance: number; }
export interface PlanResult { candidates: Candidate[]; excluded: { friendId: string; reason: string }[]; reason?: string; }
