import { Bell, CalendarDays, LifeBuoy, type LucideIcon, Lock, MessageSquare, Palette, ShieldCheck } from 'lucide-react';
import type { en } from '@/lib/i18n';

type SettingsKey = keyof typeof en;

/**
 * One entry of the Settings group list: its `/settings/<slug>` route, its name's key and the card ids it holds, in
 * order. The list's one-line summary names the shown cards unless `summaryKey` is set.
 */
export interface SettingsGroup {
  slug: string;
  nameKey: SettingsKey;
  icon: LucideIcon;
  cards: string[];
  summaryKey?: SettingsKey;
}

/**
 * The Settings groups, in list order. Every settings card id belongs to exactly one group; a group whose cards are all
 * hidden in the current mode is left out of the list.
 */
export const settingsGroups: SettingsGroup[] = [
  {
    slug: 'account',
    nameKey: 'settings.group.account',
    icon: ShieldCheck,
    cards: ['account', 'device', 'two-factor', 'discord'],
  },
  {
    slug: 'reminders',
    nameKey: 'settings.group.reminders',
    icon: Bell,
    cards: ['push', 'dm-reminders', 'phone-reminders', 'second-reminder'],
  },
  {
    slug: 'habits',
    nameKey: 'settings.group.habits',
    icon: CalendarDays,
    cards: ['routines', 'streaks', 'grace', 'timezone', 'moods'],
  },
  {
    slug: 'appearance',
    nameKey: 'settings.group.appearance',
    icon: Palette,
    cards: ['appearance'],
    summaryKey: 'settings.group.appearanceSummary',
  },
  { slug: 'privacy', nameKey: 'settings.group.privacy', icon: Lock, cards: ['journal', 'export', 'delete'] },
  {
    slug: 'feedback',
    nameKey: 'settings.group.feedback',
    icon: MessageSquare,
    cards: ['feedback'],
    summaryKey: 'settings.group.feedbackSummary',
  },
  {
    slug: 'help',
    nameKey: 'settings.group.help',
    icon: LifeBuoy,
    cards: ['help'],
    summaryKey: 'settings.group.helpSummary',
  },
];

/** The group holding the settings card with this id, if any. */
export function settingsGroupOf(cardId: string): SettingsGroup | undefined {
  return settingsGroups.find((group) => group.cards.includes(cardId));
}
