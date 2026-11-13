package app.ember.habits;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bridge to the "Today in Ember" widget: {@code update} stores a validated snapshot of today's habits in
 * app-private storage and redraws, {@code clear} forgets it, and validated widget taps arrive as
 * {@code widgetTap} events (retained until JS listens, so a cold-start tap is not lost). The "I need a moment" door
 * is a pending launch action on a cold start ({@code takeLaunchAction}) and an {@code openMoment} event on a warm one.
 */
@CapacitorPlugin(name = "EmberWidget")
public class EmberWidgetPlugin extends Plugin {

    private String launchAction;

    @PluginMethod
    public void update(PluginCall call) {
        JSArray habits = call.getArray("habits");
        Integer more = call.getInt("more");
        try {
            if (habits == null || more == null) throw new JSONException("habits and more are required");
            TodayWidget.save(
                getContext(),
                call.getString("userId"),
                call.getString("date"),
                call.getString("timeZone"),
                habits,
                more,
                call.getObject("next")
            );
        } catch (JSONException | IllegalArgumentException e) {
            call.reject("Invalid widget snapshot");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        TodayWidget.clear(getContext());
        call.resolve();
    }

    /**
     * Stores the app's language for native text ({@code language} "de", anything else or missing is "en"), then
     * redraws both widgets in it. Always resolves.
     */
    @PluginMethod
    public void setLanguage(PluginCall call) {
        AppLanguage.set(getContext(), call.getString("language"));
        TodayWidget.refresh(getContext());
        MomentWidget.refresh(getContext());
        call.resolve();
    }

    /** Resolves {@code { action: 'moment' }} or {@code { action: null }} and clears the pending launch action. */
    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject result = new JSObject();
        result.put("action", launchAction == null ? JSONObject.NULL : launchAction);
        launchAction = null;
        call.resolve(result);
    }

    void tap(JSObject tap) {
        notifyListeners("widgetTap", tap, true);
    }

    void pendMoment() {
        launchAction = "moment";
    }

    void openMoment() {
        notifyListeners("openMoment", new JSObject(), true);
    }
}
