package app.ember.habits;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * The 1x1 "I need a moment" home-screen door. It holds no user data: it only shows the door label and opens
 * {@link MainActivity} with {@link MainActivity#ACTION_OPEN_MOMENT}.
 */
public class MomentWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_moment);
        String label = AppLanguage.localized(context).getString(R.string.moment_label);
        views.setTextViewText(R.id.widget_moment_label, label);
        views.setContentDescription(R.id.widget_moment_root, label);
        Intent moment = new Intent(context, MainActivity.class).setAction(MainActivity.ACTION_OPEN_MOMENT);
        views.setOnClickPendingIntent(R.id.widget_moment_root, TodayWidget.open(context, 0, moment));
        manager.updateAppWidget(ids, views);
    }

    /** Redraws every moment widget, for example after the app's language changed. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MomentWidget.class));
        if (ids != null && ids.length > 0) new MomentWidget().onUpdate(context, manager, ids);
    }
}
