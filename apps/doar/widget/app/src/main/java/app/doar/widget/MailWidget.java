package app.doar.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** The widget itself: drawn from what the store keeps; the letters are fetched by RefreshJob. */
public final class MailWidget extends AppWidgetProvider {
    static final String REFRESH = "app.doar.widget.REFRESH";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (REFRESH.equals(intent.getAction())) {
            // ↻ was pressed: fetch now, while the phone keeps this receiver alive for it.
            PendingResult pending = goAsync();
            new Thread(() -> {
                RefreshJob.fetch(context.getApplicationContext());
                pending.finish();
            }).start();
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        Render.all(context);
        Store store = new Store(context);
        if (!store.connected()) return;
        RefreshJob.schedule(context);
        // Placed again, or the phone restarted: what is shown may be old.
        if (System.currentTimeMillis() - store.at() > 10 * 60_000) RefreshJob.now(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        Render.all(context);
    }

    @Override
    public void onDisabled(Context context) {
        // The last widget was taken off the home screen.
        RefreshJob.stop(context);
    }
}
