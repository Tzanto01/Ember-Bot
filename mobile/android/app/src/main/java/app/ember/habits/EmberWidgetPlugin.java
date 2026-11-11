package app.ember.habits;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

/**
 * Bridge to the "Today in Ember" widget: {@code update} stores a validated snapshot of today's habits in
 * app-private storage and redraws, {@code clear} forgets it, and validated widget taps arrive as
 * {@code widgetTap} events (retained until JS listens, so a cold-start tap is not lost).
 */
@CapacitorPlugin(name = "EmberWidget")
public class EmberWidgetPlugin extends Plugin {

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

    void tap(JSObject tap) {
        notifyListeners("widgetTap", tap, true);
    }
}
