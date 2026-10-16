export type SaveResult = { ok: true } | { ok: false; error: unknown; superseded: boolean };

/**
 * 키(캐릭터)마다 저장을 한 번에 하나씩 순서대로 보낸다.
 * 저장이 진행 중일 때 들어온 변경은 모아 두었다가, 다음 저장이 실제로 시작될 때의 최신 값 하나만 보낸다.
 * 그래서 늦게 도착한 오래된 요청이 새 값을 덮어쓰는 일이 없다.
 * 실패했는데 더 새 값이 대기 중이면 superseded: true (그 값이 곧 저장되므로 되돌리면 안 된다).
 */
export function createSaveQueue<T>(save: (key: string, value: T) => Promise<void>) {
  const pending = new Map<string, { value: T; waiters: ((r: SaveResult) => void)[] }>();
  const running = new Set<string>();

  async function drain(key: string) {
    running.add(key);
    try {
      for (let next = pending.get(key); next; next = pending.get(key)) {
        pending.delete(key);
        let result: SaveResult;
        try {
          await save(key, next.value);
          result = { ok: true };
        } catch (error) {
          result = { ok: false, error, superseded: pending.has(key) };
        }
        for (const w of next.waiters) w(result);
      }
    } finally {
      running.delete(key);
    }
  }

  return {
    save(key: string, value: T): Promise<SaveResult> {
      return new Promise<SaveResult>((resolve) => {
        const prev = pending.get(key);
        pending.set(key, { value, waiters: [...(prev?.waiters ?? []), resolve] });
        if (!running.has(key)) void drain(key);
      });
    },
    /** 이 키에 진행 중이거나 대기 중인 저장이 있는가. */
    isBusy(key: string): boolean {
      return running.has(key) || pending.has(key);
    },
  };
}
