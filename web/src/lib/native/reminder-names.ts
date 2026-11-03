import { Store } from '../store';

const key = 'ember.reminderNames';

/**
 * Per-device setting "Show habit names in reminders", off by default and persisted in localStorage. Off:
 * reminders say only "Ember" with a generic body; on: they name the habit or routine and single-habit reminders
 * get a "Done" action. Reset by `Reminders.clearAll()`; `DeviceSync` rebuilds the reminders when it changes.
 */
export const reminderNames = new Store<boolean>(localStorage.getItem(key) === '1');

reminderNames.subscribe(() => {
  if (reminderNames.get()) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
});
