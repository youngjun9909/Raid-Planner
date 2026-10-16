/**
 * Probe the Lost Ark Open API. Usage: npx tsx scripts/probe-lostark.ts <대표캐릭터>
 * Reads LOSTARK_JWT from the environment or .env.local. Never prints the token.
 * Prints response structure (keys) plus sample values for CombatPower/engravings.
 */
import { readFileSync } from 'node:fs';

const BASE = 'https://developer-lostark.game.onstove.com';

function loadToken(): string {
  if (process.env.LOSTARK_JWT) return process.env.LOSTARK_JWT;
  try {
    const m = readFileSync('.env.local', 'utf8').match(/^LOSTARK_JWT=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  console.error('LOSTARK_JWT가 없습니다. .env.local에 LOSTARK_JWT=<토큰>을 넣어 주세요.');
  process.exit(1);
}

async function call(path: string, token: string) {
  const res = await fetch(BASE + path, { headers: { accept: 'application/json', authorization: `bearer ${token}` } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}

async function main() {
  const name = process.argv[2];
  if (!name) { console.error('사용법: npx tsx scripts/probe-lostark.ts <대표캐릭터>'); process.exit(1); }
  const token = loadToken();

  const sib = await call(`/characters/${encodeURIComponent(name)}/siblings`, token);
  console.log('[siblings] status', sib.status);
  if (!Array.isArray(sib.body) || !sib.body.length) { console.log('원정대 없음/실패'); return; }
  console.log('(a) 원정대 필드:', Object.keys(sib.body[0]).join(', '));
  console.log('    캐릭터 수:', sib.body.length, '| 직업:', [...new Set(sib.body.map((c: any) => c.CharacterClassName))].join(', '));

  const sample = sib.body[0].CharacterName;
  const prof = await call(`/armories/characters/${encodeURIComponent(sample)}/profiles`, token);
  console.log('[profiles] status', prof.status);
  const p = prof.body ?? {};
  console.log('(b) 프로필 필드:', Object.keys(p).join(', '));
  console.log('    CombatPower 존재:', 'CombatPower' in p, '값:', JSON.stringify(p.CombatPower));
  console.log('(c) 각인 관련 필드 (ArkPassive / Engravings):');
  console.log('    ArkPassive:', JSON.stringify(p.ArkPassive)?.slice(0, 600));
  console.log('    Engravings:', JSON.stringify(p.Engravings)?.slice(0, 600));
  console.log('서포터 직업 목록(SUPPORT_CLASSES)은 사용자가 확정했어요. 위 필드 모양과 전투력 값만 fixtures와 비교하세요.');
}
main();
