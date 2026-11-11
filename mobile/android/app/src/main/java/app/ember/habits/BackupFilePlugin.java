package app.ember.habits;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Saves an export where the user can find it: {@code save} opens the system "Save as" picker
 * (Storage Access Framework, so no storage permission) and writes {@code text} as UTF-8 to the chosen document.
 * Resolves {@code { saved: false }} when the user cancels.
 */
@CapacitorPlugin(name = "BackupFile")
public class BackupFilePlugin extends Plugin {

    private static final Set<String> MIME_TYPES = Set.of("application/json", "text/csv", "text/plain");

    @PluginMethod
    public void save(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String text = call.getString("text");
        if (fileName == null || fileName.isBlank() || fileName.contains("/") || fileName.contains("\\")) {
            call.reject("Invalid file name");
            return;
        }
        if (mimeType == null || !MIME_TYPES.contains(mimeType)) {
            call.reject("Unsupported file type");
            return;
        }
        if (text == null) {
            call.reject("Text is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "created");
    }

    @ActivityCallback
    private void created(PluginCall call, ActivityResult result) {
        if (call == null) return;
        getBridge().releaseCall(call);
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(saved(false));
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IOException("No output stream");
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
        } catch (IOException | SecurityException e) {
            call.reject("Could not write the file");
            return;
        }
        call.resolve(saved(true));
    }

    private static JSObject saved(boolean saved) {
        JSObject result = new JSObject();
        result.put("saved", saved);
        return result;
    }
}
