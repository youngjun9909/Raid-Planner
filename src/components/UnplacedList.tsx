'use client';

import { useId, useState } from 'react';
import type { UnplacedCharacter } from '@/core/types';

/** 접은 상태에서 보여 줄 캐릭터 수. */
export const UNPLACED_PREVIEW = 8;

/** 친구별로 묶는다 (처음 나온 친구 순서, 친구 안에서는 받은 순서). */
function groupByFriend(list: UnplacedCharacter[]): { friendId: string; names: string[] }[] {
  const out: { friendId: string; names: string[] }[] = [];
  for (const u of list) {
    const g = out.find((x) => x.friendId === u.friendId);
    if (g) g.names.push(u.characterName);
    else out.push({ friendId: u.friendId, names: [u.characterName] });
  }
  return out;
}

/**
 * 추천 하나에서 편성되지 못한 후보 캐릭터 ("이번에 못 간 캐릭터"). 없으면 아무 것도 그리지 않는다.
 * 길면 처음 UNPLACED_PREVIEW개만 보이고 "외 N개 더 보기" 버튼으로 펼친다.
 */
export function UnplacedList({ unplaced, names, label }: { unplaced: UnplacedCharacter[]; names: Map<string, string>; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const listId = useId();
  if (unplaced.length === 0) return null;
  const hidden = Math.max(0, unplaced.length - UNPLACED_PREVIEW);
  const shown = expanded ? unplaced : unplaced.slice(0, UNPLACED_PREVIEW);
  return (
    <div className="unplaced" role="group" aria-label={`${label} 이번에 못 간 캐릭터`}>
      <p className="unplaced__title" id={titleId}>
        <span className="unplaced__label">이번에 못 간 캐릭터</span>{' '}
        <span className="muted unplaced__why">(외부인이 많이 필요해서 이번 추천에서 뺐어요)</span>
      </p>
      <ul className="unplaced__list" id={listId} aria-labelledby={titleId}>
        {groupByFriend(shown).map((g) => (
          <li key={g.friendId} className="unplaced__row">
            <span className="unplaced__friend">{names.get(g.friendId) ?? '알 수 없음'}</span>{' '}
            <span className="unplaced__chars">{g.names.join(', ')}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="link-btn unplaced__more"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? '접기' : `외 ${hidden}개 더 보기`}
        </button>
      )}
    </div>
  );
}
