import { useSyncExternalStore } from 'react';

/**
 * A minimal observable value shared between modules and React components.
 * Listeners run only when `set` or `update` changes the value by `Object.is`.
 */
export class Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  /** The current value. */
  get(): T {
    return this.value;
  }

  /** Replaces the value and notifies listeners when it changed. */
  set(value: T): void {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of [...this.listeners]) listener();
  }

  /** Sets the value to `fn(current)`. */
  update(fn: (v: T) => T): void {
    this.set(fn(this.value));
  }

  /** Calls `listener` after every change; returns the unsubscribe function. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

/** The current value of `store`; the component re-renders when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, () => store.get());
}
