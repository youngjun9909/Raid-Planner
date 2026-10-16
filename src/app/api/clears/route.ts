import { getStore } from '@/store/store';
import { RAIDS } from '@/core/raids';
import { weekKey } from '@/core/week';
import { badRequest, guard, isNonEmptyString, readJson } from '@/lib/http';

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await getStore().getClears(weekKey(new Date())));
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.characterName) || !Array.isArray(body.records)) return badRequest();
  const records: { raidName: string; difficulty: string }[] = [];
  const seen = new Set<string>();
  for (const r of body.records as unknown[]) {
    const rec = r as { raidName?: unknown; difficulty?: unknown } | null;
    if (!rec || !isNonEmptyString(rec.raidName) || !isNonEmptyString(rec.difficulty)) return badRequest();
    const { raidName, difficulty } = rec;
    if (seen.has(raidName)) return badRequest('한 레이드는 한 난이도만 선택할 수 있어요');
    seen.add(raidName);
    if (!RAIDS.some((x) => x.name === raidName && x.difficulty === difficulty)) {
      return badRequest('알 수 없는 레이드예요');
    }
    records.push({ raidName, difficulty });
  }
  await getStore().setCharacterClears(weekKey(new Date()), body.characterName, records);
  return Response.json({ ok: true });
}
