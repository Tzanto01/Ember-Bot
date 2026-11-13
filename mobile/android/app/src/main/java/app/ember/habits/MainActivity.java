package app.ember.habits;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    static final String ACTION_OPEN_MOMENT = "app.ember.habits.OPEN_MOMENT";

    private boolean restoring;
    private boolean starting;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberWidgetPlugin.class);
        registerPlugin(BackupFilePlugin.class);
        registerPlugins(FlavorPlugins.all());
        restoring = savedInstanceState != null;
        starting = true;
        super.onCreate(savedInstanceState);
        starting = false;
        restoring = false;
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            /** Goes back in the web history, or at the app's root moves Ember to the background. */
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView().canGoBack()) bridge.getWebView().goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        route(intent, starting);
    }

    /**
     * Hands a moment door or a validated widget tap to the EmberWidget plugin. Capacitor also routes the launch
     * intent here during {@code super.onCreate}; there a moment becomes the pending launch action, later an
     * {@code openMoment} event. Intents replayed from recents or a restored activity, moments not aimed at this
     * activity, and anything {@link TodayWidget#validTap} rejects, are ignored.
     */
    private void route(Intent intent, boolean cold) {
        if (restoring || intent == null || bridge == null) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        PluginHandle handle = bridge.getPlugin("EmberWidget");
        if (handle == null || !(handle.getInstance() instanceof EmberWidgetPlugin plugin)) return;
        if (ACTION_OPEN_MOMENT.equals(intent.getAction())) {
            ComponentName component = intent.getComponent();
            if (component == null || !component.getPackageName().equals(getPackageName())) return;
            if (!MainActivity.class.getName().equals(component.getClassName())) return;
            if (cold) plugin.pendMoment();
            else plugin.openMoment();
            return;
        }
        JSObject tap = TodayWidget.validTap(this, intent);
        if (tap != null) plugin.tap(tap);
    }
}
