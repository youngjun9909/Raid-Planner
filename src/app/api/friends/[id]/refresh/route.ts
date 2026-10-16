import { getStore } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { errorResponse, guard, lostArkErrorResponse } from '@/lib/http';

export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const store = getStore();
  const friend = await store.getFriend(id);
  if (!friend) return errorResponse('친구를 찾을 수 없어요', 404);
  try {
    const characters = await fetchRoster(friend.representativeName);
    // saveFriend keeps discordUserId; manual combat power overrides are stored separately.
    await store.saveFriend({ ...friend, characters });
    return Response.json(await store.getFriend(id));
  } catch (err) {
    return lostArkErrorResponse(err);
  }
}
