import { timingSafeEqual } from 'node:crypto';

export function checkPassword(req: Request): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const given = req.headers.get('x-app-password') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
