package app.ember.habits;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import com.getcapacitor.JSObject;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.Arrays;
import java.util.List;
import java.util.TimeZone;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The "Today in Ember" home-screen widget. It shows only the snapshot the app last pushed (app-private
 * SharedPreferences), and only while that snapshot (or the next day it carries) is for today in the account's zone,
 * with as many rows as the widget's height fits. Rows open
 * {@link MainActivity} with an explicit, immutable intent carrying the habit, date, user and a per-snapshot
 * token; the "I need a moment" button opens the moment flow; anywhere else opens Today.
 */
public class TodayWidget extends AppWidgetProvider {

    static final String ACTION_CHECK_IN = "app.ember.habits.WIDGET_CHECK_IN";
    static final String ACTION_OPEN_TODAY = "app.ember.habits.WIDGET_OPEN_TODAY";
    private static final String ACTION_MIDNIGHT = "app.ember.habits.WIDGET_MIDNIGHT";
    static final int MAX_ROWS = 4;

    private static final String PREFS = "ember_widget";
    private static final String SNAPSHOT = "snapshot";
    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final List<String> STATES = Arrays.asList("done", "partial", "open", "rest");
    private static final int MAX_NAME = 100;
    private static final int ROW_DP = 48;
    private static final int CHROME_DP = 92;

    private static final int[] ROWS = {
        R.id.widget_row_0, R.id.widget_row_1, R.id.widget_row_2, R.id.widget_row_3,
    };
    private static final int[] NAMES = {
        R.id.widget_name_0, R.id.widget_name_1, R.id.widget_name_2, R.id.widget_name_3,
    };
    private static final int[] STATE_TEXTS = {
        R.id.widget_state_0, R.id.widget_state_1, R.id.widget_state_2, R.id.widget_state_3,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, manager, ids);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, new int[] { id });
    }

    /** Redraws at the alarm set for the snapshot zone's next midnight, so yesterday's states never linger. */
    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_MIDNIGHT.equals(intent.getAction())) refresh(context);
        else super.onReceive(context, intent);
    }

    /**
     * Validates and stores a snapshot with a fresh tap token, then redraws every widget. {@code next} (optional,
     * {@code date}, {@code habits}, {@code more}) is the following day, shown once the zone reaches its date.
     */
    static void save(
        Context context,
        String userId,
        String date,
        String timeZone,
        JSONArray habits,
        int more,
        JSONObject next
    ) throws JSONException {
        if (userId == null || userId.isEmpty() || userId.length() > 100) throw new IllegalArgumentException("userId");
        if (timeZone == null || timeZone.isEmpty()) throw new IllegalArgumentException("timeZone");
        byte[] random = new byte[16];
        new SecureRandom().nextBytes(random);
        StringBuilder token = new StringBuilder();
        for (byte b : random) token.append(String.format(Locale.US, "%02x", b));
        JSONObject snapshot = day(date, habits, more)
            .put("userId", userId)
            .put("timeZone", timeZone)
            .put("token", token.toString());
        if (next != null) {
            String nextDate = next.optString("date");
            if (nextDate.compareTo(date) <= 0) throw new IllegalArgumentException("next");
            snapshot.put("next", day(nextDate, next.getJSONArray("habits"), next.getInt("more")));
        }
        prefs(context).edit().putString(SNAPSHOT, snapshot.toString()).commit();
        refresh(context);
    }

    private static JSONObject day(String date, JSONArray habits, int more) throws JSONException {
        if (date == null || !ISO_DATE.matcher(date).matches()) throw new IllegalArgumentException("date");
        if (habits == null || habits.length() > MAX_ROWS || more < 0) throw new IllegalArgumentException("habits");
        JSONArray rows = new JSONArray();
        for (int i = 0; i < habits.length(); i++) {
            JSONObject habit = habits.getJSONObject(i);
            long id = habit.getLong("id");
            String name = habit.getString("name").trim();
            String state = habit.getString("state");
            int count = habit.getInt("count");
            int timesPerDay = habit.getInt("timesPerDay");
            if (id <= 0 || name.isEmpty() || !STATES.contains(state) || timesPerDay < 1 || count < 0) {
                throw new IllegalArgumentException("habit");
            }
            rows.put(
                new JSONObject()
                    .put("id", id)
                    .put("name", name.length() > MAX_NAME ? name.substring(0, MAX_NAME) : name)
                    .put("state", state)
                    .put("count", Math.min(count, timesPerDay))
                    .put("timesPerDay", timesPerDay)
            );
        }
        return new JSONObject().put("date", date).put("habits", rows).put("more", more);
    }

    /** Forgets the snapshot (sign-out, session end, account deletion) and redraws the signed-out state. */
    static void clear(Context context) {
        prefs(context).edit().clear().commit();
        refresh(context);
    }

    /**
     * The JS payload for a widget intent, or null to ignore it. "Open Today" yields an empty object. A check-in
     * needs our component, a habit id above 0 that is in the current snapshot, the snapshot's date (ISO form)
     * and user, and the snapshot's tap token, so a stale row or an intent from another app does nothing.
     */
    static JSObject validTap(Context context, Intent intent) {
        ComponentName component = intent.getComponent();
        if (component == null || !component.getPackageName().equals(context.getPackageName())) return null;
        if (!MainActivity.class.getName().equals(component.getClassName())) return null;
        if (ACTION_OPEN_TODAY.equals(intent.getAction())) return new JSObject();
        if (!ACTION_CHECK_IN.equals(intent.getAction())) return null;
        JSONObject snapshot = current(context);
        if (snapshot == null) return null;
        long habitId = intent.getLongExtra("habitId", 0);
        String date = intent.getStringExtra("date");
        String userId = intent.getStringExtra("userId");
        String token = intent.getStringExtra("token");
        if (habitId <= 0 || date == null || !ISO_DATE.matcher(date).matches()) return null;
        if (!snapshot.optString("date").equals(date) || !snapshot.optString("userId").equals(userId)) return null;
        if (token == null || !snapshot.optString("token").equals(token)) return null;
        JSONArray habits = snapshot.optJSONArray("habits");
        boolean listed = false;
        for (int i = 0; habits != null && i < habits.length(); i++) {
            listed |= habits.optJSONObject(i) != null && habits.optJSONObject(i).optLong("id") == habitId;
        }
        if (!listed) return null;
        JSObject tap = new JSObject();
        tap.put("habitId", habitId);
        tap.put("date", date);
        tap.put("userId", userId);
        return tap;
    }

    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        render(context, manager, manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class)));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The stored snapshot when it, or its {@code next} day, is for today in its zone, else null. */
    private static JSONObject current(Context context) {
        String stored = prefs(context).getString(SNAPSHOT, null);
        if (stored == null) return null;
        try {
            JSONObject snapshot = new JSONObject(stored);
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone(snapshot.getString("timeZone")));
            String today = format.format(new Date());
            if (today.equals(snapshot.getString("date"))) return snapshot;
            JSONObject next = snapshot.optJSONObject("next");
            if (next == null || !today.equals(next.optString("date"))) return null;
            return snapshot
                .put("date", today)
                .put("habits", next.getJSONArray("habits"))
                .put("more", next.getInt("more"));
        } catch (JSONException e) {
            return null;
        }
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        if (ids == null || ids.length == 0) return;
        JSONObject snapshot = current(context);
        if (snapshot != null) scheduleMidnight(context, snapshot.optString("timeZone"));
        for (int id : ids) manager.updateAppWidget(id, views(context, snapshot, rows(manager, id)));
    }

    /** Rows that fit the widget's smallest reported height (landscape on phones), from 1 to {@link #MAX_ROWS}. */
    private static int rows(AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
        if (height <= 0) return MAX_ROWS;
        return Math.max(1, Math.min(MAX_ROWS, (height - CHROME_DP) / ROW_DP));
    }

    private static RemoteViews views(Context context, JSONObject snapshot, int rows) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        Context text = AppLanguage.localized(context);
        views.setTextViewText(R.id.widget_title, text.getString(R.string.widget_name));
        views.setTextViewText(R.id.widget_moment, text.getString(R.string.moment_label));
        Intent today = new Intent(context, MainActivity.class).setAction(ACTION_OPEN_TODAY);
        views.setOnClickPendingIntent(R.id.widget_root, open(context, 0, today));
        Intent moment = new Intent(context, MainActivity.class).setAction(MainActivity.ACTION_OPEN_MOMENT);
        views.setOnClickPendingIntent(R.id.widget_moment, open(context, MAX_ROWS + 1, moment));
        JSONArray habits = snapshot == null ? null : snapshot.optJSONArray("habits");
        int shown = habits == null ? 0 : Math.min(habits.length(), rows);
        int more = snapshot == null ? 0 : Math.max(0, snapshot.optInt("more")) + (habits == null ? 0 : habits.length() - shown);
        views.setTextViewText(
            R.id.widget_empty,
            text.getString(
                snapshot != null
                    ? R.string.widget_nothing_today
                    : prefs(context).contains(SNAPSHOT) ? R.string.widget_stale : R.string.widget_signed_out
            )
        );
        views.setViewVisibility(R.id.widget_empty, shown == 0 && more == 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < MAX_ROWS; i++) {
            JSONObject habit = i < shown ? habits.optJSONObject(i) : null;
            if (habit == null) {
                views.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            String name = habit.optString("name");
            String state = stateLabel(text, habit);
            views.setViewVisibility(ROWS[i], View.VISIBLE);
            views.setTextViewText(NAMES[i], name);
            views.setTextViewText(STATE_TEXTS[i], state);
            views.setContentDescription(ROWS[i], text.getString(R.string.widget_row_description, name, state));
            Intent checkIn = new Intent(context, MainActivity.class)
                .setAction(ACTION_CHECK_IN)
                .putExtra("habitId", habit.optLong("id"))
                .putExtra("date", snapshot.optString("date"))
                .putExtra("userId", snapshot.optString("userId"))
                .putExtra("token", snapshot.optString("token"));
            views.setOnClickPendingIntent(ROWS[i], open(context, i + 1, checkIn));
        }
        views.setViewVisibility(R.id.widget_more, more > 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_more, text.getString(R.string.widget_more, more));
        return views;
    }

    private static void scheduleMidnight(Context context, String timeZone) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        Calendar midnight = Calendar.getInstance(TimeZone.getTimeZone(timeZone));
        midnight.add(Calendar.DAY_OF_MONTH, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 5);
        midnight.set(Calendar.MILLISECOND, 0);
        Intent intent = new Intent(context, TodayWidget.class).setAction(ACTION_MIDNIGHT);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        alarms.set(AlarmManager.RTC, midnight.getTimeInMillis(), pending);
    }

    private static String stateLabel(Context context, JSONObject habit) {
        switch (habit.optString("state")) {
            case "done":
                return context.getString(R.string.widget_state_done);
            case "partial":
                return context.getString(R.string.widget_state_partial, habit.optInt("count"), habit.optInt("timesPerDay"));
            case "rest":
                return context.getString(R.string.widget_state_rest);
            default:
                return context.getString(R.string.widget_state_open);
        }
    }

    static PendingIntent open(Context context, int requestCode, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }
}
