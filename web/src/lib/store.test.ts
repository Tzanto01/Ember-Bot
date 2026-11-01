import { describe, expect, it, vi } from 'vitest';
import { Store } from './store';

describe('Store', () => {
  it('notifies only on a real change and stops after unsubscribe', () => {
    const store = new Store({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(store.get());
    expect(listener).not.toHaveBeenCalled();

    store.update((v) => ({ count: v.count + 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ count: 1 });

    unsubscribe();
    store.set({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
