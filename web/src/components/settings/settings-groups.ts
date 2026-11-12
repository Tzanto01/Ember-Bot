import { Bell, CalendarDays, type LucideIcon, Lock, MessageSquare, Palette, ShieldCheck } from 'lucide-react';

/**
 * One entry of the Settings group list: its `/settings/<slug>` route, its name and the card ids it holds, in order.
 * The list's one-line summary names the shown cards unless `summary` is set.
 */
export interface SettingsGroup {
  slug: string;
  name: string;
  icon: LucideIcon;
  cards: string[];
  summary?: string;
}

/**
 * The Settings groups, in list order. Every settings card id belongs to exactly one group; a group whose cards are all
 * hidden in the current mode is left out of the list.
 */
export const settingsGroups: SettingsGroup[] = [
  {
    slug: 'account',
    name: 'Account & security',
    icon: ShieldCheck,
    cards: ['account', 'device', 'discord', 'two-factor'],
  },
  {
    slug: 'reminders',
    name: 'Reminders',
    icon: Bell,
    cards: ['push', 'dm-reminders', 'phone-reminders', 'second-reminder'],
  },
  {
    slug: 'habits',
    name: 'Habits & days',
    icon: CalendarDays,
    cards: ['routines', 'grace', 'timezone', 'moods'],
  },
  {
    slug: 'appearance',
    name: 'Appearance',
    icon: Palette,
    cards: ['appearance'],
    summary: 'Light or dark, and your theme',
  },
  { slug: 'privacy', name: 'Privacy & data', icon: Lock, cards: ['journal', 'export', 'delete'] },
  {
    slug: 'feedback',
    name: 'Send feedback',
    icon: MessageSquare,
    cards: ['feedback'],
    summary: 'Tell us what would make Ember better',
  },
];

/** The group holding the settings card with this id, if any. */
export function settingsGroupOf(cardId: string): SettingsGroup | undefined {
  return settingsGroups.find((group) => group.cards.includes(cardId));
}
