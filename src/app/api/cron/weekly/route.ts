import { timingSafeEqual } from 'node:crypto';
import { getStore } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { runWeekly } from '@/lib/weekly';

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 설정이 없으면 열어 두지 않는다
  const a = Buffer.from(req.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron이 주 1회 호출한다 (vercel.json). */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response('unauthorized', { status: 401 });
  const summary = await runWeekly({ store: getStore(), fetchRoster: (n) => fetchRoster(n), now: () => new Date() });
  return Response.json(summary);
}
