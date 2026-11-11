package app.ember.habits;

import android.content.Intent;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    private boolean restoring;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberWidgetPlugin.class);
        registerPlugin(BackupFilePlugin.class);
        restoring = savedInstanceState != null;
        super.onCreate(savedInstanceState);
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

    /**
     * Hands a validated widget tap to the EmberWidget plugin. Intents replayed from recents or a restored
     * activity, and anything {@link TodayWidget#validTap} rejects, are ignored.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (restoring || intent == null || bridge == null) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        JSObject tap = TodayWidget.validTap(this, intent);
        if (tap == null) return;
        PluginHandle handle = bridge.getPlugin("EmberWidget");
        if (handle != null && handle.getInstance() instanceof EmberWidgetPlugin plugin) plugin.tap(tap);
    }
}
