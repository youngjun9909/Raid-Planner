import { timingSafeEqual } from 'node:crypto';
import { isProduction } from '@/lib/env';

/**
 * 'ok' 통과, 'denied' 비밀번호 틀림, 'unconfigured' 배포 환경인데 APP_PASSWORD가 없음.
 * APP_PASSWORD가 없을 때는 로컬 개발(VERCEL 없음, NODE_ENV≠production)에서만 열어 둔다.
 */
export type PasswordStatus = 'ok' | 'denied' | 'unconfigured';

export function passwordStatus(req: Request): PasswordStatus {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return isProduction() ? 'unconfigured' : 'ok';
  const given = req.headers.get('x-app-password') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return 'denied';
  return timingSafeEqual(a, b) ? 'ok' : 'denied';
}

export function checkPassword(req: Request): boolean {
  return passwordStatus(req) === 'ok';
}
