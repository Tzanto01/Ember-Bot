package app.ember.habits;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/**
 * Updates the sideloaded beta (beta flavor only; Play builds never contain it). {@code canInstall} resolves
 * {@code { value }} for the "Install unknown apps" permission, {@code openInstallSettings} opens that setting for
 * Ember, and {@code downloadAndInstall({ url, sha256, size? })} downloads an https APK to the cache, checks its
 * SHA-256 (and size when given) and opens Android's package installer, which always asks the user to confirm.
 * Emits {@code downloadProgress} with {@code { received, total }} while downloading.
 */
@CapacitorPlugin(name = "EmberUpdater")
public class EmberUpdaterPlugin extends Plugin {

    private static final String APK_TYPE = "application/vnd.android.package-archive";
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private static final Pattern SHA256 = Pattern.compile("[0-9a-fA-F]{64}");

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        worker.execute(() -> clear(updatesDir()));
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        try {
            getActivity().startActivity(intent);
        } catch (RuntimeException e) {
            call.reject("Could not open the setting");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        Object rawSize = call.getData().isNull("size") ? null : call.getData().opt("size");
        Long size = rawSize instanceof Integer || rawSize instanceof Long ? ((Number) rawSize).longValue() : null;
        if (url == null || !url.toLowerCase(Locale.ROOT).startsWith("https://")) {
            call.reject("The update must come over https");
            return;
        }
        if (sha256 == null || !SHA256.matcher(sha256).matches()) {
            call.reject("Invalid checksum");
            return;
        }
        if (rawSize != null && (size == null || size <= 0 || size > MAX_BYTES)) {
            call.reject("Invalid size");
            return;
        }
        worker.execute(() -> download(call, url, sha256, size));
    }

    private void download(PluginCall call, String url, String sha256, Long size) {
        File dir = updatesDir();
        clear(dir);
        File apk = new File(dir, "ember-update.apk");
        HttpURLConnection connection = null;
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No cache directory");
            connection = (HttpsURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + connection.getResponseCode());
            long limit = size != null ? size : MAX_BYTES;
            long total = size != null ? size : connection.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long received = 0;
            long reported = -1;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    received += read;
                    if (received > limit) throw new IOException("Too large");
                    digest.update(buffer, 0, read);
                    out.write(buffer, 0, read);
                    long percent = total > 0 ? received * 100 / total : -1;
                    if (percent != reported) {
                        reported = percent;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total > 0 ? total : 0);
                        notifyListeners("downloadProgress", progress);
                    }
                }
            }
            if (!matches(sha256, size, digest.digest(), received)) {
                clear(dir);
                call.reject("The download didn't match the update", "MISMATCH");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_TYPE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
            clear(dir);
            call.reject("Could not download the update");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * True when a download of {@code actualSize} bytes with SHA-256 {@code actualDigest} is the expected file:
     * the digest equals {@code expectedSha256} (hex, any case) and, when {@code expectedSize} is given, the size matches.
     */
    static boolean matches(String expectedSha256, Long expectedSize, byte[] actualDigest, long actualSize) {
        if (expectedSize != null && expectedSize != actualSize) return false;
        StringBuilder hex = new StringBuilder(actualDigest.length * 2);
        for (byte b : actualDigest) hex.append(String.format(Locale.ROOT, "%02x", b));
        return MessageDigest.isEqual(
            hex.toString().getBytes(StandardCharsets.US_ASCII),
            expectedSha256.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII)
        );
    }

    private File updatesDir() {
        return new File(getContext().getCacheDir(), "updates");
    }

    private static void clear(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) file.delete();
    }
}
