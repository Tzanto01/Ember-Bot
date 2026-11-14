import { t } from '@/lib/i18n';
import type { Intensity, MomentState } from './types';

/**
 * Every user-facing string of the "I need a moment" flow, in the current language (practice texts live in
 * `content/practices.{en,de}.json`, crisis lines in `content/crisis-lines.{en,de}.json`). One module so the content
 * test can scan it for claim words.
 */
export const momentCopy = {
  get leave() {
    return t('moment.leave');
  },
  get leaveDraft() {
    return t('moment.leaveDraft');
  },
  get keepWriting() {
    return t('moment.keepWriting');
  },
  get urgentHelp() {
    return t('moment.urgentHelp');
  },
  get done() {
    return t('moment.done');
  },
  get back() {
    return t('moment.back');
  },
  get next() {
    return t('moment.next');
  },
  get finish() {
    return t('moment.finish');
  },
  get skip() {
    return t('moment.skip');
  },
  get continue() {
    return t('moment.continue');
  },
  get tryAnother() {
    return t('moment.tryAnother');
  },
  get skipPractice() {
    return t('moment.skipPractice');
  },
  get catchHeading() {
    return t('moment.catch.heading');
  },
  get catchName() {
    return t('moment.catch.name');
  },
  get catchBreathe() {
    return t('moment.catch.breathe');
  },
  get helpedBefore() {
    return t('moment.catch.helpedBefore');
  },
  get reminderEyebrow() {
    return t('moment.reminder.eyebrow');
  },
  get nameHeading() {
    return t('moment.name.heading');
  },
  get nameLede() {
    return t('moment.name.lede');
  },
  tiles: {
    get rejected() {
      return t('moment.tile.rejected');
    },
    get overloaded() {
      return t('moment.tile.overloaded');
    },
    get racing() {
      return t('moment.tile.racing');
    },
    get replaying() {
      return t('moment.tile.replaying');
    },
    get unsure() {
      return t('moment.tile.unsure');
    },
  } satisfies Record<MomentState, string>,
  get intensityHeading() {
    return t('moment.intensity.heading');
  },
  get intensityLede() {
    return t('moment.intensity.lede');
  },
  intensity: {
    get 1() {
      return t('moment.intensity.1');
    },
    get 2() {
      return t('moment.intensity.2');
    },
    get 3() {
      return t('moment.intensity.3');
    },
    get 4() {
      return t('moment.intensity.4');
    },
    get 5() {
      return t('moment.intensity.5');
    },
  } satisfies Record<Intensity, string>,
  stepOf: (title: string, step: number, total: number) =>
    t('moment.stepOf', { title, step, total }),
  get breathHeading() {
    return t('moment.breath.heading');
  },
  get breathRunningHeading() {
    return t('moment.breath.headingRunning');
  },
  get start() {
    return t('moment.start');
  },
  get pause() {
    return t('moment.pause');
  },
  get resume() {
    return t('moment.resume');
  },
  get startAgain() {
    return t('moment.startAgain');
  },
  get breatheIn() {
    return t('moment.breath.in');
  },
  get hold() {
    return t('moment.breath.hold');
  },
  get breatheOut() {
    return t('moment.breath.out');
  },
  round: (round: number, rounds: number) => t('moment.breath.round', { round, rounds }),
  get breathPaused() {
    return t('moment.breath.paused');
  },
  get breathDone() {
    return t('moment.breath.done');
  },
  timerStarted: (time: string) => t('moment.timer.started', { time }),
  seconds: (count: number) => t('moment.timer.seconds', { count }),
  get timerDone() {
    return t('moment.timer.done');
  },
  get afterHeading() {
    return t('moment.after.heading');
  },
  get afterLede() {
    return t('moment.after.lede');
  },
  get endHeading() {
    return t('moment.end.heading');
  },
  get endLede() {
    return t('moment.end.lede');
  },
  get reflect() {
    return t('moment.reflect');
  },
  get reflectHeading() {
    return t('moment.reflect.heading');
  },
  get setItOff() {
    return t('moment.reflect.setItOff');
  },
  get setItOffHint() {
    return t('moment.reflect.setItOffHint');
  },
  charactersLeft: (left: number) => t('moment.reflect.charactersLeft', { left }),
  get timerLabel() {
    return t('moment.timer.label');
  },
  get timerResumed() {
    return t('moment.timer.resumed');
  },
  get limitReached() {
    return t('moment.reflect.limitReached');
  },
  get helped() {
    return t('moment.reflect.helped');
  },
  get nothingHelped() {
    return t('moment.reflect.nothingHelped');
  },
  get howNow() {
    return t('moment.reflect.howNow');
  },
  get save() {
    return t('moment.reflect.save');
  },
  get saving() {
    return t('moment.reflect.saving');
  },
  get saved() {
    return t('moment.reflect.saved');
  },
  get savesPrivate() {
    return t('moment.reflect.savesPrivate');
  },
  get savesAfterUnlock() {
    return t('moment.reflect.savesAfterUnlock');
  },
  showingLines: (place: string) => t('crisis.showing', { place }),
  get newPassphraseLater() {
    return t('moment.reflect.newPassphraseLater');
  },
  get needsPrivate() {
    return t('moment.reflect.needsPrivate');
  },
  get openPrivacy() {
    return t('moment.reflect.openPrivacy');
  },
  get needsConsent() {
    return t('moment.reflect.needsConsent');
  },
  get openConsent() {
    return t('moment.reflect.openConsent');
  },
  get notSaved() {
    return t('moment.reflect.notSaved');
  },
  get checking() {
    return t('moment.reflect.checking');
  },
  get offline() {
    return t('moment.reflect.offline');
  },
  get full() {
    return t('moment.reflect.full');
  },
  get yourMoments() {
    return t('moment.reflect.yourMoments');
  },
  get saveFailed() {
    return t('moment.reflect.saveFailed');
  },
};
