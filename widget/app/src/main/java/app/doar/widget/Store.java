package app.doar.widget;

import android.content.Context;
import android.content.SharedPreferences;

/** What the widget remembers on the phone: its key, the last letters it got, and how the last try went. */
final class Store {
    /** The last try worked. */
    static final String OK = "";
    /** No connection, or the server did not answer: the last letters stay on show. */
    static final String OFFLINE = "offline";
    /** Google no longer lets Doar in; the person has to sign in to Doar again. */
    static final String REAUTH = "reauth";

    private final SharedPreferences prefs;

    Store(Context context) {
        prefs = context.getSharedPreferences("doar-widget", Context.MODE_PRIVATE);
    }

    String key() {
        return prefs.getString("key", null);
    }

    boolean connected() {
        return key() != null;
    }

    void connect(String key) {
        prefs.edit().putString("key", key).remove("data").remove("problem").putLong("at", 0).apply();
    }

    /** The key was disconnected in Doar's settings: forget it and what it showed. */
    void forget() {
        prefs.edit().clear().apply();
    }

    /** The server's last answer, as it came (JSON), or null. */
    String data() {
        return prefs.getString("data", null);
    }

    /** When the last answer arrived (milliseconds since 1970), 0 if never. */
    long at() {
        return prefs.getLong("at", 0);
    }

    String problem() {
        return prefs.getString("problem", OK);
    }

    boolean busy() {
        // A refresh that never finished (the phone killed it) stops counting after a minute.
        return System.currentTimeMillis() - prefs.getLong("busy", 0) < 60_000;
    }

    void setBusy(boolean busy) {
        prefs.edit().putLong("busy", busy ? System.currentTimeMillis() : 0).apply();
    }

    void saved(String data) {
        prefs.edit().putString("data", data).putLong("at", System.currentTimeMillis()).putString("problem", OK).apply();
    }

    void failed(String problem) {
        prefs.edit().putString("problem", problem).apply();
    }
}
