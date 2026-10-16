import type { Tier } from '@/core/types';
import { TIER_META } from '@/lib/view-model';

export function TierBadge({ tier }: { tier: Tier }) {
  const meta = TIER_META[tier];
  return (
    <span className={`tier tier--${tier}`} title={meta.hint}>
      <span className="tier__icon" aria-hidden="true">
        {meta.icon}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
