package app.ember.habits;

import com.getcapacitor.Plugin;
import java.util.List;

/** Plugins only the sideloaded beta build registers. */
final class FlavorPlugins {

    private FlavorPlugins() {}

    static List<Class<? extends Plugin>> all() {
        return List.of(EmberUpdaterPlugin.class);
    }
}
