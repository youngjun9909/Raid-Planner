import { RAIDS } from '@/core/raids';
import type { ClearRecord, RaidConfig, Role, Slot, Tier } from '@/core/types';

/** 레이드 이름별 묶음 (설정 순서 유지). 클리어 표의 열과 레이드 선택 화면에 쓴다. */
export interface RaidGroup { name: string; raids: RaidConfig[]; }

export const RAID_GROUPS: RaidGroup[] = RAIDS.reduce<RaidGroup[]>((groups, raid) => {
  const g = groups.find((x) => x.name === raid.name);
  if (g) g.raids.push(raid);
  else groups.push({ name: raid.name, raids: [raid] });
  return groups;
}, []);

export const RAID_NAMES: string[] = RAID_GROUPS.map((g) => g.name);

/** 드롭다운 값: 이번 주에 간 난이도, 안 갔으면 ''. */
export function clearValue(clears: ClearRecord[], characterName: string, raidName: string): string {
  return clears.find((c) => c.characterName === characterName && c.raidName === raidName)?.difficulty ?? '';
}

/**
 * 드롭다운 하나를 바꾼 뒤 그 캐릭터의 전체 클리어 목록 (PUT /api/clears 본문의 records).
 * 레이드 이름당 한 난이도만 남는다: 같은 레이드의 다른 난이도를 고르면 기존 값을 대신한다.
 */
export function recordsAfterChange(
  clears: ClearRecord[],
  characterName: string,
  raidName: string,
  difficulty: string,
): { raidName: string; difficulty: string }[] {
  const mine = clears.filter((c) => c.characterName === characterName);
  const out: { raidName: string; difficulty: string }[] = [];
  let placed = false;
  for (const c of mine) {
    if (c.raidName === raidName) {
      if (!placed && difficulty) out.push({ raidName, difficulty });
      placed = true;
    } else {
      out.push({ raidName: c.raidName, difficulty: c.difficulty });
    }
  }
  if (!placed && difficulty) out.push({ raidName, difficulty });
  return out;
}

/** 로컬 상태에도 같은 변경을 반영한 클리어 목록. */
export function applyClearChange(
  clears: ClearRecord[],
  characterName: string,
  records: { raidName: string; difficulty: string }[],
): ClearRecord[] {
  return [...clears.filter((c) => c.characterName !== characterName), ...records.map((r) => ({ characterName, ...r }))];
}

const cpFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
export function formatCP(cp: number | null): string {
  return cp === null ? '—' : cpFormat.format(Math.round(cp));
}

export function formatLevel(level: number): string {
  return level.toFixed(2).replace(/\.?0+$/, '');
}

export function formatRange(raid: RaidConfig): string {
  const { min, max } = raid.recommendedCP;
  return max === null ? `${formatCP(min)} 이상` : `${formatCP(min)}~${formatCP(max)}`;
}

export const ROLE_LABEL: Record<Role, string> = { support: '서포터', dealer: '딜러' };

/** 단계는 색만으로 구분하지 않도록 아이콘과 글자를 함께 쓴다. */
export const TIER_META: Record<Tier, { label: string; icon: string; hint: string }> = {
  comfortable: { label: '여유', icon: '◆', hint: '딜러 평균이 권장 전투력 이상' },
  tight: { label: '빠듯함', icon: '▲', hint: '권장 최소치의 90% 이상' },
  risky: { label: '위험', icon: '✕', hint: '권장 최소치의 90% 미만' },
  unknown: { label: '모름', icon: '?', hint: '전투력을 아는 딜러가 없어요' },
};

export function countExternals(slots: Slot[]): { support: number; dealer: number } {
  let support = 0;
  let dealer = 0;
  for (const s of slots) {
    if (s.kind !== 'external') continue;
    if (s.role === 'support') support++;
    else dealer++;
  }
  return { support, dealer };
}

export function externalSummary(support: number, dealer: number): string {
  const total = support + dealer;
  if (total === 0) return '외부 인원 없이 가능';
  const parts = [support ? `서포터 ${support}` : '', dealer ? `딜러 ${dealer}` : ''].filter(Boolean);
  return `외부 ${total}명 필요 (${parts.join(', ')})`;
}
