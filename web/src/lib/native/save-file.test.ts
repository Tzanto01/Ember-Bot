import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from '../api-client';
import { env } from '../env';
import { saveExport } from './save-file';

const save = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ save }) }));
vi.mock('../env', () => ({ env: { native: false } }));
vi.mock('../api-client', () => ({ saveFile: vi.fn() }));

describe('saveExport', () => {
  const file = { blob: new Blob(['{"a":1}'], { type: 'text/csv' }), fileName: 'ember.csv' };

  beforeEach(() => {
    save.mockReset();
    vi.mocked(saveFile).mockReset();
  });

  it('hands name, type and text to the native picker and returns whether it saved', async () => {
    env.native = true;
    save.mockResolvedValueOnce({ saved: true }).mockResolvedValueOnce({ saved: false });

    expect(await saveExport(file)).toBe(true);
    expect(await saveExport({ blob: new Blob(['x']), fileName: 'b.json' })).toBe(false);

    expect(save).toHaveBeenNthCalledWith(1, { fileName: 'ember.csv', mimeType: 'text/csv', text: '{"a":1}' });
    expect(save).toHaveBeenNthCalledWith(2, { fileName: 'b.json', mimeType: 'application/json', text: 'x' });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('downloads through the browser on the web', async () => {
    env.native = false;

    expect(await saveExport(file)).toBe(true);

    expect(saveFile).toHaveBeenCalledWith(file);
    expect(save).not.toHaveBeenCalled();
  });
});
