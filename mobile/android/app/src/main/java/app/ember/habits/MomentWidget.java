package app.ember.habits;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
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
        Intent moment = new Intent(context, MainActivity.class).setAction(MainActivity.ACTION_OPEN_MOMENT);
        views.setOnClickPendingIntent(R.id.widget_moment_root, TodayWidget.open(context, 0, moment));
        manager.updateAppWidget(ids, views);
    }
}
