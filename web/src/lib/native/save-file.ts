import { registerPlugin } from '@capacitor/core';
import { type ExportFile, saveFile } from '../api-client';
import { env } from '../env';

/** The custom native plugin (`BackupFile`, Android only): a system "Save as" picker that writes `text`. */
export interface BackupFilePlugin {
  save(options: { fileName: string; mimeType: string; text: string }): Promise<{ saved: boolean }>;
}

const BackupFile = registerPlugin<BackupFilePlugin>('BackupFile');

/**
 * Saves an export where the user can find it: the native "Save as" picker in the app (a WebView ignores
 * `<a download>`), a browser download on the web. Resolves false when the user cancels the picker.
 */
export async function saveExport(file: ExportFile): Promise<boolean> {
  if (!env.native) {
    saveFile(file);
    return true;
  }
  const { saved } = await BackupFile.save({
    fileName: file.fileName,
    mimeType: file.blob.type || 'application/json',
    text: await file.blob.text(),
  });
  return saved;
}
