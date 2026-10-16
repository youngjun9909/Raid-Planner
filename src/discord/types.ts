/** Discord Interactions 웹훅에서 쓰는 최소 타입 (필요한 필드만). */

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;
export const EPHEMERAL = 64;

export interface DiscordUser { id: string; username?: string; global_name?: string | null; }

export interface CommandOptionValue { name: string; type: number; value?: unknown; }

export interface DiscordInteraction {
  type: number;
  id?: string;
  application_id?: string;
  token?: string;
  member?: { user?: DiscordUser; nick?: string | null };
  user?: DiscordUser;
  data?: {
    name?: string;
    options?: CommandOptionValue[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
  };
}

export interface SelectOption { label: string; value: string; description?: string; default?: boolean; }
export interface StringSelect {
  type: 3;
  custom_id: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options: SelectOption[];
}
/** style: 1 Primary, 2 Secondary, 3 Success, 4 Danger. */
export interface Button { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; emoji?: { name: string }; }
export interface ActionRow { type: 1; components: (StringSelect | Button)[]; }

export interface EmbedField { name: string; value: string; inline?: boolean; }
export interface Embed {
  author?: { name: string };
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface MessageData {
  content: string;
  flags?: number;
  embeds?: Embed[];
  components?: ActionRow[];
  allowed_mentions?: { parse: string[] };
}

/** type 1/5/6에는 data가 없고, 4/7에는 메시지 data가 있다. */
export interface DiscordResponse {
  type: (typeof ResponseType)[keyof typeof ResponseType];
  data?: MessageData;
}
