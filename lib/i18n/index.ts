/**
 * i18n public API.
 *
 *  messages.ts   en/zh dictionary + formatMessage
 *  provider.tsx  LocaleProvider / useLocale / detectBrowserLocale
 */

export type { Locale, MessageKey, MessageVars } from '@/lib/i18n/messages';
export { dict, formatMessage } from '@/lib/i18n/messages';
export {
  LocaleProvider,
  useLocale,
  detectBrowserLocale,
} from '@/lib/i18n/provider';
