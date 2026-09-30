// The resolved copy for this page load: `copy` is one of the four bundles,
// `lang` its code. Both are fixed at module load — changing language reloads
// the page rather than re-rendering in place.
import { en, type Copy } from './en';
import { ms } from './ms';
import { zh } from './zh';
import { zhTW } from './zhTW';
import { activeLang, type LangCode } from './lang';
import type { RoomCode } from '../config/site';

export type { Copy } from './en';
export type { LangCode } from './lang';

const COPIES: Record<LangCode, Copy> = { en, ms, zh, 'zh-TW': zhTW };

export const lang: LangCode = activeLang();
export const copy: Copy = COPIES[lang];

/** A room type's name in this language (the rooms list's order). */
const ROOM_INDEX: Record<RoomCode, number> = { STDQ: 0, DLX: 1, SUP: 2, FR: 3, FS: 4 };
export const roomName = (code: RoomCode): string => copy.rooms.items[ROOM_INDEX[code]].name;

/** One or several: `[one, many]` templates with `{{n}}`. */
export const count = (forms: readonly [string, string], n: number): string =>
  (n === 1 ? forms[0] : forms[1]).replace(/\{\{n\}\}/g, String(n));

/** Fills `{{name}}` slots — same placeholder convention as the app's i18n. */
export const fill = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (slot, key: string) => vars[key]?.toString() ?? slot);

/**
 * Resolves a dotted `data-i18n` path ("rooms.items.2.name") against a bundle.
 * Returns undefined for unknown paths so applyCopy leaves the English static
 * HTML in place rather than blanking the element.
 */
export const copyAt = (path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key];
    return undefined;
  }, copy);
