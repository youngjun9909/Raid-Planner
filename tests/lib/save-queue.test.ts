import { describe, expect, it } from 'vitest';
import { createSaveQueue } from '@/lib/save-queue';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createSaveQueue', () => {
  it('runs one save per key at a time and sends the latest value when it starts (coalescing)', async () => {
    const started: { key: string; value: string[] }[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    const q = createSaveQueue<string[]>((key, value) => {
      started.push({ key, value });
      const d = deferred();
      gates.push(d);
      return d.promise;
    });
    const r1 = q.save('가나', ['세르카']);
    const r2 = q.save('가나', ['세르카', '벨가르딘']);
    const r3 = q.save('가나', ['세르카', '벨가르딘', '지평의 성당']);
    await flush();
    expect(started).toEqual([{ key: '가나', value: ['세르카'] }]);
    expect(q.isBusy('가나')).toBe(true);

    gates[0].resolve();
    await expect(r1).resolves.toEqual({ ok: true });
    await flush();
    // 두 번째와 세 번째 변경은 하나로 합쳐 최신 값만 보낸다.
    expect(started).toHaveLength(2);
    expect(started[1].value).toEqual(['세르카', '벨가르딘', '지평의 성당']);

    gates[1].resolve();
    await expect(r2).resolves.toEqual({ ok: true });
    await expect(r3).resolves.toEqual({ ok: true });
    expect(q.isBusy('가나')).toBe(false);
  });

  it('runs different keys independently', async () => {
    const started: string[] = [];
    const q = createSaveQueue<number>(async (key) => { started.push(key); await new Promise(() => {}); });
    void q.save('a', 1);
    void q.save('b', 1);
    await flush();
    expect(started).toEqual(['a', 'b']);
  });

  it('reports a failure as superseded when a newer value is still queued', async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    const q = createSaveQueue<number>(() => { const d = deferred(); gates.push(d); return d.promise; });
    const r1 = q.save('a', 1);
    const r2 = q.save('a', 2);
    await flush();
    gates[0].reject(new Error('boom'));
    const res1 = await r1;
    expect(res1).toMatchObject({ ok: false, superseded: true });
    await flush();
    gates[1].resolve();
    await expect(r2).resolves.toEqual({ ok: true });
  });

  it('reports a plain failure when nothing newer is queued', async () => {
    const q = createSaveQueue<number>(async () => { throw new Error('boom'); });
    const res = await q.save('a', 1);
    expect(res).toMatchObject({ ok: false, superseded: false });
    expect((res as { error: Error }).error.message).toBe('boom');
    expect(q.isBusy('a')).toBe(false);
  });
});
