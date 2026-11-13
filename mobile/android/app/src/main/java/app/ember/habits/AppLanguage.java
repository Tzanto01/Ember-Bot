package app.ember.habits;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.Configuration;
import java.util.Locale;

/**
 * The app's language for text built natively (widgets), as last set by the web app through
 * {@code EmberWidget.setLanguage}. It lives in its own SharedPreferences, so signing out keeps it.
 */
final class AppLanguage {

    private static final String PREFS = "ember_language";
    private static final String LANGUAGE = "language";

    private AppLanguage() {}

    /** Stores {@code "de"} for {@code "de"}, else {@code "en"} (unknown or missing values included). */
    static void set(Context context, String language) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(LANGUAGE, "de".equals(language) ? "de" : "en")
            .apply();
    }

    /** The stored language, or from the device's first locale ({@code de*} is German) when none is stored yet. */
    static String get(Context context) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LANGUAGE, null);
        if (stored != null) return stored;
        Locale device = context.getResources().getConfiguration().getLocales().get(0);
        return device != null && "de".equals(device.getLanguage()) ? "de" : "en";
    }

    /** A context whose resources resolve strings in {@link #get}'s language (language splits are off in the bundle). */
    @SuppressLint("AppBundleLocaleChanges")
    static Context localized(Context context) {
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.setLocale(Locale.forLanguageTag(get(context)));
        return context.createConfigurationContext(config);
    }
}
