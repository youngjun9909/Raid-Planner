import type { Party, Slot } from '@/core/types';

/**
 * 공대 카드에 보여 줄 순서 (표시 전용, 편성 계산과 무관).
 * 4인: 딜러 3 → 서포터 1 한 덩어리. 8인: 4인 파티 두 덩어리, 각각 딜러 3 → 서포터 1.
 * 어떤 경우에도 슬롯을 하나도 잃거나 중복하지 않는다. 원본은 바꾸지 않는다.
 */
const isSupport = (s: Slot): boolean => (s.kind === 'external' ? s.role === 'support' : s.character.role === 'support');

/** 딜러: 전투력 높은 순 → 전투력 모름(템렙 높은 순) → 외부. */
function dealerOrder(a: Slot, b: Slot): number {
  if (a.kind !== b.kind) return a.kind === 'friend' ? -1 : 1;
  if (a.kind !== 'friend' || b.kind !== 'friend') return 0;
  const ac = a.character.combatPower;
  const bc = b.character.combatPower;
  if (ac !== null && bc !== null) return bc - ac || b.character.itemLevel - a.character.itemLevel;
  if (ac !== null) return -1;
  if (bc !== null) return 1;
  return b.character.itemLevel - a.character.itemLevel;
}

/** 서포터: 친구 먼저(템렙 높은 순), 외부 나중. */
function supportOrder(a: Slot, b: Slot): number {
  if (a.kind !== b.kind) return a.kind === 'friend' ? -1 : 1;
  if (a.kind !== 'friend' || b.kind !== 'friend') return 0;
  return b.character.itemLevel - a.character.itemLevel;
}

export function arrangeParty(party: Party, raidSize: number): Slot[][] {
  const dealers = party.slots.filter((s) => !isSupport(s)).sort(dealerOrder); // filter가 새 배열을 만들어 원본은 그대로
  const supports = party.slots.filter(isSupport).sort(supportOrder);
  if (raidSize !== 8) return [[...dealers, ...supports]];

  const blocks: { d: Slot[]; s: Slot[] }[] = [{ d: [], s: [] }, { d: [], s: [] }];
  // 뱀 순서(A B B A A B)로 나눠 두 덩어리의 전투력 합을 비슷하게 맞춘다. 덩어리 안에서는 이미 내림차순.
  dealers.forEach((slot, i) => blocks[Math.floor(i / 2) % 2 === 0 ? i % 2 : 1 - (i % 2)].d.push(slot));
  supports.forEach((slot, i) => blocks[i % 2].s.push(slot));
  return blocks.map((b) => [...b.d, ...b.s]).filter((b) => b.length > 0);
}
