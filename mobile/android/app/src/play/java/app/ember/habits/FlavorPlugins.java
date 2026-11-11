package app.ember.habits;

import com.getcapacitor.Plugin;
import java.util.List;

/** Plugins only this flavor registers: none for the Play build, which must not update itself. */
final class FlavorPlugins {

    private FlavorPlugins() {}

    static List<Class<? extends Plugin>> all() {
        return List.of();
    }
}
