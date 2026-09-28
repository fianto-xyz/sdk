export type ButtonTheme = 'brand' | 'dark' | 'light' | 'outline' | 'auto';
export type ButtonLabel = 'plain' | 'pay' | 'buy' | 'checkout' | 'subscribe' | 'donate';
export type ButtonShape = 'rect' | 'rounded' | 'pill';
export type ButtonSize = 'static' | 'fill';
export type ButtonLocale = 'en' | 'vi';

export interface ButtonOptions {
  theme?: ButtonTheme;
  label?: ButtonLabel;
  shape?: ButtonShape;
  size?: ButtonSize;
  /** Any string is accepted; only `en`/`vi` (or their navigator-language base) resolve, else `en`. */
  locale?: string;
  loading?: boolean;
  disabled?: boolean;
}

export interface ResolvedButton {
  theme: ButtonTheme;
  label: ButtonLabel;
  shape: ButtonShape;
  size: ButtonSize;
  locale: ButtonLocale;
  loading: boolean;
  disabled: boolean;
}

const THEMES: readonly ButtonTheme[] = ['brand', 'dark', 'light', 'outline', 'auto'];
const LABELS: readonly ButtonLabel[] = ['plain', 'pay', 'buy', 'checkout', 'subscribe', 'donate'];
const SHAPES: readonly ButtonShape[] = ['rect', 'rounded', 'pill'];
const SIZES: readonly ButtonSize[] = ['static', 'fill'];
const LOCALES: readonly ButtonLocale[] = ['en', 'vi'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function resolveLocale(option: string | undefined, navigatorLanguage: string | undefined): ButtonLocale {
  if (typeof option === 'string' && (LOCALES as readonly string[]).includes(option)) return option as ButtonLocale;
  const base = navigatorLanguage?.split('-')[0];
  if (base && (LOCALES as readonly string[]).includes(base)) return base as ButtonLocale;
  return 'en';
}

/** Unknown values (an option outside its allowed set) silently fall back to the default — never throws. */
export function resolveButtonOptions(options: ButtonOptions, navigatorLanguage?: string): ResolvedButton {
  return {
    theme: pick(options.theme, THEMES, 'brand'),
    label: pick(options.label, LABELS, 'pay'),
    shape: pick(options.shape, SHAPES, 'rounded'),
    size: pick(options.size, SIZES, 'static'),
    locale: resolveLocale(options.locale, navigatorLanguage),
    loading: options.loading === true,
    disabled: options.disabled === true,
  };
}
