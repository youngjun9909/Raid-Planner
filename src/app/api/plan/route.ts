import { getStore } from '@/store/store';
import { getRaid } from '@/core/raids';
import { planRaid } from '@/core/planner';
import { proficiencyLookup } from '@/core/proficiency';
import { weekKey } from '@/core/week';
import { badRequest, guard, readJson, withConfigErrors } from '@/lib/http';

export const POST = withConfigErrors(async (req: Request) => {
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
  // 숙련도는 저장소가 친구마다 붙여 준 값(레이드 이름 기준)을 쓴다. 정하지 않은 칸은 반숙.
  const result = planRaid({ raid, friends, clears, attendeeIds: body.attendeeIds as string[], proficiency: proficiencyLookup(friends, raid.name) });
  return Response.json({ ...result, raid });
});
