import { getStore } from '@/store/store';
import { difficultiesOf, isTargetDifficultyFor, SKIP_DIFFICULTY, TARGET_RAID_NAMES } from '@/core/difficulty';
import { visibleCharacters, visibleFriend } from '@/core/visible';
import { badRequest, errorResponse, guard, isNonEmptyString, readJson, withConfigErrors } from '@/lib/http';

/**
 * 가는 난이도 지정 (설계 수정 2026-10-16-friend-first-amendment.md A).
 * body: { characterName, raidName, difficulty: <그 레이드 이름의 난이도> | '안 감' | null } (null이면 자동 기본값으로).
 * raidName은 난이도 없는 레이드 이름(RAIDS의 name). 캐릭터는 화면에 보이는(1700 이상) 이 친구의 캐릭터만. 응답은 친구.
 */
export const PUT = withConfigErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const store = getStore();
  const friend = await store.getFriend(id);
  if (!friend) return errorResponse('친구를 찾을 수 없어요', 404);
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.characterName)) return badRequest('캐릭터 이름이 필요해요');
  const raidName = body.raidName;
  if (typeof raidName !== 'string' || !TARGET_RAID_NAMES.includes(raidName)) return badRequest('알 수 없는 레이드예요');
  const difficulty = body.difficulty;
  if (difficulty !== null && !isTargetDifficultyFor(raidName, difficulty)) {
    return badRequest(`${raidName}의 난이도는 ${[...difficultiesOf(raidName), SKIP_DIFFICULTY].join(', ')} 또는 null이어야 해요`);
  }
  if (!visibleCharacters(friend.characters).some((c) => c.name === body.characterName)) {
    return badRequest('이 친구의 캐릭터가 아니에요');
  }
  await store.setTargetDifficulty(id, body.characterName, raidName, difficulty);
  const saved = await store.getFriend(id);
  return Response.json(saved && visibleFriend(saved));
});
