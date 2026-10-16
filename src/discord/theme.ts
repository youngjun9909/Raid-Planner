import type { Tier } from '@/core/types';

/** 디스코드 메시지의 시각 체계: 아이콘과 색은 여기서만 정의한다. */

export const BOT_NAME = '로아 공대 도우미';

export const ICON = {
  support: '🛡️',
  dealer: '⚔️',
  external: '➕',
  star: '⭐',
  clear: '✅',
  status: '📋',
  week: '🗓️',
  help: '📖',
  party: '🏰',
  celebrate: '🎉',
  error: '⚠️',
  refresh: '🔄',
  empty: '💤',
  web: '🌐',
} as const;

export const COLOR = {
  comfortable: 0x57f287,
  tight: 0xfee75c,
  risky: 0xed4245,
  unknown: 0x95a5a6,
  brand: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
} as const;

export const TIER_TEXT: Record<Tier, string> = {
  comfortable: '🟢 여유',
  tight: '🟡 빠듯함',
  risky: '🔴 위험',
  unknown: '⚪ 모름',
};

export const TIER_COLOR: Record<Tier, number> = {
  comfortable: COLOR.comfortable,
  tight: COLOR.tight,
  risky: COLOR.risky,
  unknown: COLOR.unknown,
};

/** 나쁜 정도. 후보 전체의 색은 가장 나쁜 공대를 따른다. */
export const TIER_BADNESS: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };

export const GAUGE = { full: '▰', empty: '▱', cells: 10 } as const;
