import type { Store } from '@/store/store';
import type { Character } from '@/core/types';
import { weekKey } from '@/core/week';
import { LostArkError } from '@/lostark/client';

export interface WeeklyDeps {
  store: Store;
  fetchRoster: (representativeName: string) => Promise<Character[]>;
  now: () => Date;
}

export interface WeeklySummary {
  deletedWeek: string;
  refreshed: number;
  failed: { friendId: string; error: string }[];
}

/** weekKey의 간단한 숫자 해시 (FNV-1a 32bit). 같은 주에는 항상 같은 값. */
function hashWeek(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * 갱신 시작 위치를 주차마다 돌린다. 시간 제한이나 요청 제한으로 중간에 끊겨도
 * 매주 같은 친구들만 갱신에서 빠지지 않게 한다. 한 번 끝까지 돌면 모두 한 번씩 갱신된다.
 */
export function rotate<T>(items: T[], week: string): T[] {
  if (items.length === 0) return items;
  const offset = hashWeek(week) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/** 지난주 클리어 기록을 지우고, 등록된 친구의 로스터를 (주차별로 돌린) 순서대로 갱신한다. 토큰/예외 원문은 결과에 넣지 않는다. */
export async function runWeekly({ store, fetchRoster, now }: WeeklyDeps): Promise<WeeklySummary> {
  const deletedWeek = weekKey(new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000));
  await store.deleteWeek(deletedWeek);

  const friends = rotate(await store.listFriends(), weekKey(now()));
  const summary: WeeklySummary = { deletedWeek, refreshed: 0, failed: [] };
  let rateLimited = false;
  for (const f of friends) {
    if (rateLimited) {
      summary.failed.push({ friendId: f.id, error: 'rate_limited' });
      continue;
    }
    try {
      const characters = await fetchRoster(f.representativeName);
      // saveFriend가 discordUserId를 보존하고, 수동 전투력은 별도 저장소라 그대로 남는다.
      await store.saveFriend({ ...f, characters });
      summary.refreshed++;
    } catch (e) {
      if (e instanceof LostArkError) {
        if (e.code === 'rate_limited') rateLimited = true;
        summary.failed.push({ friendId: f.id, error: e.code === 'rate_limited' ? 'rate_limited' : e.message });
      } else {
        summary.failed.push({ friendId: f.id, error: '알 수 없는 오류' });
      }
    }
  }
  return summary;
}
