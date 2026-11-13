/** What the user named in the moment flow (contract companion-v1). */
export type MomentState = 'rejected' | 'overloaded' | 'racing' | 'replaying' | 'unsure';

/** One step of a practice: plain text, a paced-breathing player, or a timer. */
export type PracticeStep =
  | { kind: 'text'; text: string }
  | { kind: 'breath'; inhale: number; hold: number; exhale: number; rounds: number }
  | { kind: 'timer'; seconds: number; text: string };

/** One practice of `content/practices.{en,de}.json`. `basis` names the public technique for content review and is never shown. */
export interface Practice {
  id: string;
  version: number;
  title: string;
  states: MomentState[];
  type: 'breathing' | 'grounding' | 'orientation' | 'reframe' | 'urge-surfing';
  minutes: number;
  steps: PracticeStep[];
  a11y: { motion: 'none' | 'gentle'; languageLevel: 'plain' };
  basis: string;
}

/** The 1 to 5 worded intensity scale, "A little" to "A lot". */
export type Intensity = 1 | 2 | 3 | 4 | 5;
