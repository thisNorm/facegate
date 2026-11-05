import crypto from 'node:crypto';
import { sameSecret, sha256 } from '../../shared/secret.ts';
import { hashPassword, verifyPassword } from '../../shared/password.ts';
import { kst } from '../../shared/time.ts';
import type { SettingRepository } from './setting.repository.ts';

export type SettingService = ReturnType<typeof createSettingService>;

const HASH = 'ingest_key_hash';
const HINT = 'ingest_key_hint';
const DUPLICATE_WINDOW = 'duplicate_window_sec';
const PHOTO_RETENTION = 'photo_retention_days';
const TERMINAL_ADMIN_MODE = 'terminal_admin_mode';
const TERMINAL_ADMIN_PIN = 'terminal_admin_pin_hash';

const TERMINAL_LIGHT = 'terminal_light';
const TERMINAL_VOICE = 'terminal_voice';
const FACE_ENGINE = 'face_engine';

/** 얼굴 인식을 어디서 하나: PC의 AI 서버(영상을 받아 감) 또는 단말 안 (D-63) */
export type FaceEngine = 'AI_SERVER' | 'TERMINAL';

/** 단말 관리자 확인 방식: 웹 관리자 계정 또는 관리자 번호 (D-58) */
export type TerminalAdminMode = 'ACCOUNT' | 'PIN';

/** 단말 외관 불빛이 낼 수 있는 색 (빨강, 초록, 파랑을 켜고 끄는 조합). 단말 GateLight와 같은 이름 */
export const LIGHT_COLORS = [
  'WHITE',
  'GREEN',
  'RED',
  'BLUE',
  'YELLOW',
  'PURPLE',
  'CYAN',
  'OFF',
] as const;
export type LightColor = (typeof LIGHT_COLORS)[number];
/** 대기, 통과, 불통일 때의 불빛 색 */
export type TerminalLight = { idle: LightColor; granted: LightColor; denied: LightColor };
const DEFAULT_LIGHT: TerminalLight = { idle: 'WHITE', granted: 'GREEN', denied: 'RED' };

/** 단말 음성 안내 문구 (통과, 거부, 미등록). 빈 글자면 확인음만 */
export type TerminalVoice = { granted: string; denied: string; unregistered: string };
const DEFAULT_VOICE: TerminalVoice = {
  granted: '인증되었습니다',
  denied: '출입 권한이 없습니다',
  // 미등록은 지나가는 사람에게도 울리므로 기본은 말하지 않는다 (05 문서 T-03)
  unregistered: '',
};
const VOICE_MAX = 40;

export type GeneralSettings = { duplicateWindowSec: number; photoRetentionDays: number };

const RULES: Record<keyof GeneralSettings, { name: string; min: number; max: number }> = {
  duplicateWindowSec: { name: DUPLICATE_WINDOW, min: 1, max: 60 },
  photoRetentionDays: { name: PHOTO_RETENTION, min: 7, max: 365 },
};

/** 설정 값 규칙 위반. 컨트롤러가 400으로 돌려줌 */
export class SettingInputError extends Error {}

export function createSettingService({
  settings,
  now = () => new Date(),
  defaults = {},
}: {
  settings: SettingRepository;
  now?: () => Date;
  defaults?: Partial<GeneralSettings>;
}) {
  function save(key: string): string {
    const issuedAt = kst(now());
    settings.set(HINT, key.slice(-4), issuedAt);
    settings.set(HASH, sha256(key), issuedAt);
    return issuedAt;
  }

  const fallback: GeneralSettings = { duplicateWindowSec: 5, photoRetentionDays: 90, ...defaults };

  function generalSettings(): GeneralSettings {
    const read = (key: keyof GeneralSettings) => {
      const stored = settings.get(RULES[key].name);
      return stored ? Number(stored.value) : fallback[key];
    };
    return {
      duplicateWindowSec: read('duplicateWindowSec'),
      photoRetentionDays: read('photoRetentionDays'),
    };
  }

  return {
    /** 새 키를 만들어 저장하고 전체 키를 돌려준다. 이전 키는 바로 무효. 평문은 저장하지 않음 */
    issueIngestKey(): { key: string; issuedAt: string } {
      const key = crypto.randomBytes(32).toString('hex');
      return { key, issuedAt: save(key) };
    },

    ingestKeyInfo(): { issued: boolean; hint: string | null; issuedAt: string | null } {
      const hash = settings.get(HASH);
      return {
        issued: hash !== undefined,
        hint: settings.get(HINT)?.value ?? null,
        issuedAt: hash?.updatedAt ?? null,
      };
    },

    verifyIngestKey(candidate: string | undefined): boolean {
      const hash = settings.get(HASH);
      return (
        hash !== undefined && candidate !== undefined && sameSecret(sha256(candidate), hash.value)
      );
    },

    generalSettings,

    /** 보낸 항목만 바꾼다. 하나라도 규칙을 어기면 아무것도 바꾸지 않고 SettingInputError */
    updateGeneralSettings(input: Record<string, unknown>): GeneralSettings {
      const changes: Partial<GeneralSettings> = {};
      for (const key of Object.keys(RULES) as (keyof GeneralSettings)[]) {
        const value = input[key];
        if (value === undefined) continue;
        const { min, max } = RULES[key];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
          throw new SettingInputError(`${key} must be an integer between ${min} and ${max}`);
        changes[key] = value;
      }
      if (!Object.keys(changes).length) throw new SettingInputError('no known settings given');
      const at = kst(now());
      for (const [key, value] of Object.entries(changes) as [keyof GeneralSettings, number][])
        settings.set(RULES[key].name, String(value), at);
      return generalSettings();
    },

    terminalAdmin(): { mode: TerminalAdminMode; pinSet: boolean } {
      return {
        mode: settings.get(TERMINAL_ADMIN_MODE)?.value === 'PIN' ? 'PIN' : 'ACCOUNT',
        pinSet: settings.get(TERMINAL_ADMIN_PIN) !== undefined,
      };
    },

    /** 번호는 4~8자리 숫자, scrypt로만 저장. 번호 없이 PIN 방식은 고를 수 없다 */
    async updateTerminalAdmin(input: Record<string, unknown>) {
      const { mode, pin } = input;
      if (mode !== undefined && mode !== 'ACCOUNT' && mode !== 'PIN')
        throw new SettingInputError('mode must be ACCOUNT or PIN');
      if (pin !== undefined && (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)))
        throw new SettingInputError('pin must be 4 to 8 digits');
      if (mode === undefined && pin === undefined)
        throw new SettingInputError('no known settings given');
      if (mode === 'PIN' && pin === undefined && settings.get(TERMINAL_ADMIN_PIN) === undefined)
        throw new SettingInputError('set a pin before choosing PIN mode');
      const at = kst(now());
      if (pin !== undefined)
        settings.set(TERMINAL_ADMIN_PIN, await hashPassword(pin as string), at);
      if (mode !== undefined) settings.set(TERMINAL_ADMIN_MODE, mode as string, at);
      return this.terminalAdmin();
    },

    faceEngine(): FaceEngine {
      return settings.get(FACE_ENGINE)?.value === 'TERMINAL' ? 'TERMINAL' : 'AI_SERVER';
    },

    updateFaceEngine(input: Record<string, unknown>): FaceEngine {
      const { engine } = input;
      if (engine !== 'AI_SERVER' && engine !== 'TERMINAL')
        throw new SettingInputError('engine must be AI_SERVER or TERMINAL');
      settings.set(FACE_ENGINE, engine, kst(now()));
      return engine;
    },

    terminalLight(): TerminalLight {
      const stored = settings.get(TERMINAL_LIGHT);
      return stored
        ? { ...DEFAULT_LIGHT, ...(JSON.parse(stored.value) as Partial<TerminalLight>) }
        : DEFAULT_LIGHT;
    },

    /** 보낸 상태만 바꾼다. 색은 LIGHT_COLORS 중 하나만 */
    updateTerminalLight(input: Record<string, unknown>): TerminalLight {
      const next = { ...this.terminalLight() };
      let changed = false;
      for (const key of Object.keys(DEFAULT_LIGHT) as (keyof TerminalLight)[]) {
        const value = input[key];
        if (value === undefined) continue;
        if (!LIGHT_COLORS.includes(value as LightColor))
          throw new SettingInputError(`${key} must be one of ${LIGHT_COLORS.join(', ')}`);
        next[key] = value as LightColor;
        changed = true;
      }
      if (!changed) throw new SettingInputError('no known settings given');
      settings.set(TERMINAL_LIGHT, JSON.stringify(next), kst(now()));
      return next;
    },

    terminalVoice(): TerminalVoice {
      const stored = settings.get(TERMINAL_VOICE);
      return stored
        ? { ...DEFAULT_VOICE, ...(JSON.parse(stored.value) as Partial<TerminalVoice>) }
        : DEFAULT_VOICE;
    },

    /** 보낸 문구만 바꾼다. 앞뒤 공백은 지우고 40자까지 */
    updateTerminalVoice(input: Record<string, unknown>): TerminalVoice {
      const next = { ...this.terminalVoice() };
      let changed = false;
      for (const key of Object.keys(DEFAULT_VOICE) as (keyof TerminalVoice)[]) {
        const value = input[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.trim().length > VOICE_MAX)
          throw new SettingInputError(`${key} must be text up to ${VOICE_MAX} characters`);
        next[key] = value.trim();
        changed = true;
      }
      if (!changed) throw new SettingInputError('no known settings given');
      settings.set(TERMINAL_VOICE, JSON.stringify(next), kst(now()));
      return next;
    },

    async verifyTerminalPin(pin: string): Promise<boolean> {
      const stored = settings.get(TERMINAL_ADMIN_PIN);
      return stored !== undefined && (await verifyPassword(pin, stored.value));
    },

    /** .env의 INGEST_KEY를 최초 1회만 반영, DB에 이미 키가 있으면 무시 */
    seedIngestKey(key: string | undefined): void {
      if (key && !settings.get(HASH)) save(key);
    },
  };
}
