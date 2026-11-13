/** Most items the "What helps me" list keeps (contract companion-v1 "What helps me"). */
export const maxHelps = 20;
/** Longest item text, after trimming. */
export const maxHelpText = 80;

/** One "What helps me" item: the user's words, or a practice title with its `practiceId`. */
export interface HelpItem {
  id: string;
  text: string;
  practiceId?: string;
  /** ISO timestamp of when it was added. */
  addedAt: string;
}

/** The plaintext of the encrypted list. */
export interface HelpsList {
  v: 1;
  items: HelpItem[];
}
