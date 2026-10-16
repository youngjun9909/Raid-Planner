import { RAIDS } from '@/core/raids';
import { SKIP_DIFFICULTY, TARGET_RAID_NAMES, difficultiesOf } from '@/core/difficulty';
import { PROFICIENCIES, RAID_NAMES_FOR_PROFICIENCY } from '@/core/proficiency';
import type { RaidConfig } from '@/core/types';

/** 슬래시 명령어 옵션 타입 (Discord ApplicationCommandOptionType). */
const STRING = 3;

export interface CommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: { name: string; value: string }[];
  /** 입력하는 동안 봇에게 선택지를 물어본다 (interaction type 4). choices와 함께 쓰지 않는다. */
  autocomplete?: boolean;
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

/** /난이도의 "자동" 선택지 (저장된 값을 지우고 레벨로 정한다). */
export const AUTO_DIFFICULTY = '자동';

/** /난이도 난이도 선택지: 자동 + 모든 난이도 이름의 합집합(보기 좋은 순서) + 안 감. */
const DIFFICULTY_ORDER = ['노말', '하드', '나이트메어', '1단계', '2단계', '3단계'];
const allDifficultyNames = [...new Set(TARGET_RAID_NAMES.flatMap(difficultiesOf))]
  .sort((a, b) => {
    const ia = DIFFICULTY_ORDER.indexOf(a);
    const ib = DIFFICULTY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
export const DIFFICULTY_CHOICES = [AUTO_DIFFICULTY, ...allDifficultyNames, SKIP_DIFFICULTY];

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
    name: '숙련도',
    description: '내 캐릭터의 레이드별 숙련도(숙련·반숙·클경)를 정해요. 공대 추천에 반영돼요',
    group: '공대 짜기',
    example: '/숙련도 캐릭터:홍길동 레이드:세르카 숙련도:숙련',
    options: [
      { type: STRING, name: '캐릭터', description: '내 캐릭터 이름 (입력하면 내 캐릭터 목록이 떠요)', required: true, autocomplete: true },
      {
        type: STRING,
        name: '레이드',
        description: '레이드 이름 (난이도와 상관없이 같은 숙련도예요)',
        required: true,
        choices: RAID_NAMES_FOR_PROFICIENCY.map((n) => ({ name: n, value: n })),
      },
      {
        type: STRING,
        name: '숙련도',
        description: '숙련(익숙함) · 반숙(보통, 기본값) · 클경(클리어 경험만)',
        required: true,
        choices: PROFICIENCIES.map((p) => ({ name: p, value: p })),
      },
    ],
  },
  {
    name: '난이도',
    description: '내 캐릭터가 레이드마다 어떤 난이도로 가는지 정해요 (자동은 레벨로 갈 수 있는 가장 높은 난이도)',
    group: '공대 짜기',
    example: '/난이도 캐릭터:홍길동 레이드:카제로스 4막 (아르모체) 난이도:노말',
    options: [
      { type: STRING, name: '캐릭터', description: '내 캐릭터 이름 (입력하면 내 캐릭터 목록이 떠요)', required: true, autocomplete: true },
      {
        type: STRING,
        name: '레이드',
        description: '레이드 이름 (난이도는 따로 골라요)',
        required: true,
        choices: TARGET_RAID_NAMES.map((n) => ({ name: n, value: n })),
      },
      {
        type: STRING,
        name: '난이도',
        description: '자동(레벨로 가장 높은 난이도) · 가는 난이도 · 안 감(그 레이드는 안 가요)',
        required: true,
        choices: DIFFICULTY_CHOICES.map((n) => ({ name: n, value: n })),
      },
    ],
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
