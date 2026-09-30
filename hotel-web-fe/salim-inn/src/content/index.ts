// The resolved copy for this page load: `lang` is the visitor's language,
// fixed at module load — changing language reloads the page rather than
// re-rendering in place. English ships with the page (it is the static HTML's
// own language and the shape every bundle follows); any other bundle is its
// own chunk, so a visitor downloads one language rather than all four, and the
// page's first script stays small enough for a slow phone's largest paint.
// `copy` is English until `ready` settles: main.ts applies the copy and starts
// the film only after it, and accountActions.ts waits for it too.
import { en, type Copy } from './en';
import { activeLang, type LangCode } from './lang';
import type { RoomCode } from '../config/site';

export type { Copy } from './en';
export type { LangCode } from './lang';

const LOADERS: Record<Exclude<LangCode, 'en'>, () => Promise<Copy>> = {
  ms: () => import('./ms').then((m) => m.ms),
  zh: () => import('./zh').then((m) => m.zh),
  'zh-TW': () => import('./zhTW').then((m) => m.zhTW),
};

export const lang: LangCode = activeLang();
export let copy: Copy = en;

/** Settles once `copy` is this page's language — at once for English. False
 *  when the bundle could not be fetched (offline mid-load): the page then
 *  stays in its static English. */
export const ready: Promise<boolean> =
  lang === 'en'
    ? Promise.resolve(true)
    : LOADERS[lang]().then(
        (loaded) => {
          copy = loaded;
          return true;
        },
        (err: unknown) => {
          console.error(err);
          return false;
        },
      );

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
