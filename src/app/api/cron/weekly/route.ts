import { timingSafeEqual } from 'node:crypto';
import { getStore } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { runWeekly } from '@/lib/weekly';
import { withConfigErrors } from '@/lib/http';

// 친구 수 x 캐릭터 수만큼 프로필을 0.7초 간격으로 부르므로 60초를 넘을 수 있다.
// Vercel Hobby + Fluid compute는 300초까지 허용한다 (Fluid compute가 꺼져 있으면 더 낮은 한도가 적용된다).
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 설정이 없으면 열어 두지 않는다
  const a = Buffer.from(req.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron이 주 1회 호출한다 (vercel.json). */
export const GET = withConfigErrors(async (req: Request) => {
  if (!authorized(req)) return new Response('unauthorized', { status: 401 });
  const summary = await runWeekly({ store: getStore(), fetchRoster: (n) => fetchRoster(n), now: () => new Date() });
  return Response.json(summary);
});
