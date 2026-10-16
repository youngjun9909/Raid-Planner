import { getStore } from '@/store/store';
import { getRaid } from '@/core/raids';
import { planRaid } from '@/core/planner';
import { weekKey } from '@/core/week';
import { badRequest, guard, readJson } from '@/lib/http';

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body || !Array.isArray(body.attendeeIds) || !body.attendeeIds.every((x) => typeof x === 'string')) {
    return badRequest('참석자 목록이 필요해요');
  }
  const raid = typeof body.raidId === 'string' ? getRaid(body.raidId) : undefined;
  if (!raid) return badRequest('알 수 없는 레이드예요');
  const store = getStore();
  const [friends, clears] = await Promise.all([store.listFriends(), store.getClears(weekKey(new Date()))]);
  const result = planRaid({ raid, friends, clears, attendeeIds: body.attendeeIds as string[] });
  return Response.json({ ...result, raid });
}
