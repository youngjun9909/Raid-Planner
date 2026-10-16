/**
 * 슬래시 명령어를 디스코드에 등록한다. 사용법: npm run register-commands
 * DISCORD_APP_ID, DISCORD_BOT_TOKEN을 환경변수 또는 .env.local에서 읽는다. 토큰은 출력하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { registrationPayload } from '../src/discord/commands';

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync('.env.local', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return undefined;
}

async function main() {
  const appId = env('DISCORD_APP_ID');
  const token = env('DISCORD_BOT_TOKEN');
  if (!appId || !token) {
    console.error('DISCORD_APP_ID와 DISCORD_BOT_TOKEN이 필요해요. .env.local에 넣어 주세요.');
    process.exit(1);
  }
  const commands = registrationPayload();
  const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bot ${token}` },
    body: JSON.stringify(commands),
  });
  if (res.ok) {
    console.log(`등록 성공 (HTTP ${res.status}): ${commands.map((c) => `/${c.name}`).join(', ')}`);
  } else {
    console.error(`등록 실패 (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('등록 중 오류:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
