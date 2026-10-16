import { RAIDS } from '@/core/raids';
import type { RaidConfig } from '@/core/types';

/** 슬래시 명령어 옵션 타입 (Discord ApplicationCommandOptionType). */
const STRING = 3;

export interface CommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: { name: string; value: string }[];
}

export interface CommandDef {
  name: string;
  description: string;
  options?: CommandOption[];
  /** /명령어 도움말의 묶음 이름. Discord에 등록할 때는 빠진다. */
  group: string;
  /** /명령어 도움말에 보여 줄 사용 예시. Discord에 등록할 때는 빠진다. */
  example: string;
}

export const raidTitle = (raid: RaidConfig): string => `${raid.name} ${raid.difficulty}`;

export const COMMAND_GROUPS = ['시작하기', '공대 짜기', '클리어 관리'] as const;

export const COMMANDS: CommandDef[] = [
  {
    name: '명령어',
    description: '사용할 수 있는 명령어와 사용법을 보여 줘요',
    group: '시작하기',
    example: '/명령어',
  },
  {
    name: '등록',
    description: '대표 캐릭터로 내 원정대를 등록하거나 갱신해요',
    group: '시작하기',
    example: '/등록 대표캐릭터:홍길동',
    options: [{ type: STRING, name: '대표캐릭터', description: '내 원정대의 아무 캐릭터 이름', required: true }],
  },
  {
    name: '공대',
    description: '레이드를 고르면 등록된 친구 전원으로 공대 후보를 짜 줘요',
    group: '공대 짜기',
    example: '/공대 레이드:세르카 하드',
    options: [{
      type: STRING,
      name: '레이드',
      description: '갈 레이드와 난이도',
      required: true,
      choices: RAIDS.map((r) => ({ name: raidTitle(r), value: r.id })),
    }],
  },
  {
    name: '클리어',
    description: '내 캐릭터의 이번 주 클리어를 표시해요',
    group: '클리어 관리',
    example: '/클리어 → 캐릭터 고르기 → 클리어한 레이드 고르기',
  },
  {
    name: '현황',
    description: '이번 주 전체 클리어 현황을 보여 줘요',
    group: '클리어 관리',
    example: '/현황',
  },
  {
    name: '웹',
    description: '웹 화면으로 가는 버튼을 보여 줘요',
    group: '시작하기',
    example: '/웹',
  },
];

/** Discord에 등록할 본문 (group, example 같은 내부 필드는 뺀다). */
export function registrationPayload() {
  return COMMANDS.map(({ name, description, options }) => ({ type: 1, name, description, ...(options ? { options } : {}) }));
}
