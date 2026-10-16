import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_URL, getWebUrl } from '@/lib/web-url';

describe('getWebUrl', () => {
  it('설정이 없으면 기본 주소', () => {
    expect(getWebUrl({})).toBe('https://goawon-raid-planner.vercel.app');
    expect(DEFAULT_WEB_URL).toBe('https://goawon-raid-planner.vercel.app');
  });
  it('WEB_URL이 올바른 https 주소면 그 값, 끝의 슬래시는 뗀다', () => {
    expect(getWebUrl({ WEB_URL: 'https://example.com/app' })).toBe('https://example.com/app');
    expect(getWebUrl({ WEB_URL: 'https://example.com/' })).toBe('https://example.com');
    expect(getWebUrl({ WEB_URL: '  https://example.com//  ' })).toBe('https://example.com');
  });
  it('https가 아니거나 잘못된 값이면 기본 주소', () => {
    for (const v of ['http://example.com', 'example.com', 'javascript:alert(1)', '', '   ', 'not a url']) {
      expect(getWebUrl({ WEB_URL: v })).toBe(DEFAULT_WEB_URL);
    }
  });
  it('비밀번호가 섞인 주소(사용자 정보, 쿼리, 해시)는 쓰지 않는다', () => {
    for (const v of ['https://user:pw@example.com', 'https://example.com/?password=1', 'https://example.com/#x']) {
      expect(getWebUrl({ WEB_URL: v })).toBe(DEFAULT_WEB_URL);
    }
  });
});
