import type { Character, Friend } from '@/core/types';

export const PW = 'secret';
export function req(url: string, method = 'GET', body?: unknown, password: string | null = PW): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (password !== null) headers['x-app-password'] = password;
  return new Request(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const ch = (name: string, role: 'dealer' | 'support' = 'dealer', cp: number | null = 3000, itemLevel = 1760): Character =>
  ({ name, className: '버서커', role, itemLevel, combatPower: cp });
export const friend = (id: string, chars: Character[]): Friend =>
  ({ id, displayName: id, representativeName: chars[0].name, characters: chars });
