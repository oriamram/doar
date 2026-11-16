package app.doar.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Doar's settings hand the widget its key: doarwidget://connect?key=…
 * The key is kept, the letters are fetched, and when no widget is on the home screen yet
 * the phone offers to put one there.
 */
public final class ConnectActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri link = getIntent().getData();
        String key = link == null ? null : link.getQueryParameter("key");
        if (key == null || !key.matches("[A-Za-z0-9_-]{43}")) {
            Toast.makeText(this, R.string.connect_bad, Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        new Store(this).connect(key);
        RefreshJob.schedule(this);
        Context app = getApplicationContext();
        new Thread(() -> RefreshJob.fetch(app)).start();

        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        ComponentName widget = new ComponentName(this, MailWidget.class);
        if (manager.getAppWidgetIds(widget).length == 0 && manager.isRequestPinAppWidgetSupported()) {
            Toast.makeText(this, R.string.connect_place, Toast.LENGTH_LONG).show();
            manager.requestPinAppWidget(widget, null, null);
        } else {
            Toast.makeText(this, R.string.connect_done, Toast.LENGTH_LONG).show();
        }
        finish();
    }
}
