package app.doar.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.ArrayMap;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Drawing the widget from what the store keeps. Two shapes, and the phone picks by the
 * widget's size: a small one (the count of new letters), and a sheet with the letters.
 */
final class Render {
    private Render() {}

    /** One letter on the widget (the server's WidgetLetter, supabase/functions/postman/widget.ts). */
    private static final class Letter {
        String thread, from, subject, code;
        long at;
        boolean unread, starred;
        int count;
    }

    /** Everything a drawing needs, read once. */
    private static final class Shown {
        boolean connected, busy, haveData, more;
        String problem;
        long fetchedAt;
        int unread;
        final List<Letter> letters = new ArrayList<>();
    }

    static void all(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MailWidget.class));
        if (ids.length == 0) return;
        Shown shown = read(context);
        for (int id : ids) {
            Map<SizeF, RemoteViews> shapes = new ArrayMap<>();
            shapes.put(new SizeF(100f, 40f), small(context, shown));
            shapes.put(new SizeF(180f, 140f), sheet(context, shown));
            manager.updateAppWidget(id, new RemoteViews(shapes));
        }
    }

    private static Shown read(Context context) {
        Store store = new Store(context);
        Shown shown = new Shown();
        shown.connected = store.connected();
        shown.busy = store.busy();
        shown.problem = store.problem();
        shown.fetchedAt = store.at();
        String data = store.data();
        if (data == null) return shown;
        try {
            JSONObject answer = new JSONObject(data);
            shown.unread = answer.optInt("unread");
            shown.more = answer.optBoolean("more");
            JSONArray letters = answer.optJSONArray("letters");
            for (int i = 0; letters != null && i < letters.length(); i++) {
                JSONObject row = letters.getJSONObject(i);
                Letter letter = new Letter();
                letter.thread = row.getString("thread");
                letter.from = row.optString("from");
                letter.subject = row.optString("subject");
                letter.code = row.isNull("code") ? null : row.optString("code", null);
                letter.at = row.optLong("at");
                letter.unread = row.optBoolean("unread");
                letter.starred = row.optBoolean("starred");
                letter.count = row.optInt("count", 1);
                shown.letters.add(letter);
            }
            shown.haveData = true;
        } catch (JSONException error) {
            // A broken answer is the same as none: the next refresh replaces it.
        }
        return shown;
    }

    // ---------- The two shapes ----------

    private static RemoteViews small(Context context, Shown shown) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_small);
        views.setTextViewText(R.id.count, shown.connected && shown.haveData ? countNumber(shown) : "·");
        views.setTextViewText(R.id.subtitle, line(context, shown, false));
        views.setOnClickPendingIntent(R.id.small_root, open(context, shown.connected ? "" : "?widget"));
        return views;
    }

    private static RemoteViews sheet(Context context, Shown shown) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget);
        views.setTextViewText(R.id.subtitle, line(context, shown, true));
        views.setOnClickPendingIntent(R.id.title_box, open(context, ""));
        views.setOnClickPendingIntent(R.id.compose, open(context, "?compose"));
        views.setOnClickPendingIntent(
                R.id.refresh,
                PendingIntent.getBroadcast(context, 0, new Intent(context, MailWidget.class).setAction(MailWidget.REFRESH), PendingIntent.FLAG_IMMUTABLE));
        views.setViewVisibility(R.id.refresh, shown.connected ? View.VISIBLE : View.GONE);

        RemoteViews.RemoteCollectionItems.Builder rows = new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1);
        for (Letter letter : shown.letters) rows.addItem(letter.thread.hashCode(), row(context, letter));
        views.setRemoteAdapter(R.id.list, rows.build());
        views.setPendingIntentTemplate(
                R.id.list,
                PendingIntent.getActivity(context, 100, new Intent(context, OpenActivity.class), PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        views.setEmptyView(R.id.list, R.id.empty);

        boolean offline = Store.OFFLINE.equals(shown.problem) && !shown.busy;
        int empty = !shown.connected
                ? R.string.empty_unlinked
                : !shown.haveData ? (offline ? R.string.empty_offline : R.string.empty_loading) : R.string.empty_none;
        views.setTextViewText(R.id.empty, context.getString(empty));
        views.setOnClickPendingIntent(R.id.empty, open(context, shown.connected ? "" : "?widget"));
        return views;
    }

    private static RemoteViews row(Context context, Letter letter) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.row);
        row.setViewVisibility(R.id.seal, letter.unread ? View.VISIBLE : View.INVISIBLE);
        row.setViewVisibility(R.id.from_new, letter.unread ? View.VISIBLE : View.GONE);
        row.setViewVisibility(R.id.from_old, letter.unread ? View.GONE : View.VISIBLE);
        row.setTextViewText(letter.unread ? R.id.from_new : R.id.from_old, letter.from);
        row.setTextViewText(R.id.count, letter.count > 1 ? String.valueOf(letter.count) : "");
        row.setViewVisibility(R.id.count, letter.count > 1 ? View.VISIBLE : View.GONE);
        row.setTextViewText(R.id.when, (letter.starred ? "★ " : "") + when(letter.at));
        row.setTextViewText(R.id.subject, letter.subject);
        row.setViewVisibility(R.id.code, letter.code != null ? View.VISIBLE : View.GONE);
        if (letter.code != null) row.setTextViewText(R.id.code, context.getString(R.string.code, letter.code));
        row.setContentDescription(R.id.row, (letter.unread ? context.getString(R.string.new_letter) + " " : "") + letter.from + ". " + letter.subject);
        row.setOnClickFillInIntent(R.id.row, new Intent().setData(Uri.parse(Doar.SITE + "?thread=" + Uri.encode(letter.thread))));
        return row;
    }

    // ---------- Words ----------

    private static String countNumber(Shown shown) {
        return shown.more ? "100+" : String.valueOf(shown.unread);
    }

    /** "3 מכתבים חדשים · 14:05", or what is wrong. */
    private static String line(Context context, Shown shown, boolean withTime) {
        if (!shown.connected) return context.getString(R.string.unlinked);
        if (!shown.haveData) {
            return context.getString(Store.OFFLINE.equals(shown.problem) && !shown.busy ? R.string.offline_none : R.string.loading);
        }
        String count = shown.more
                ? context.getString(R.string.count_more)
                : shown.unread == 0
                        ? context.getString(R.string.count_none)
                        : context.getResources().getQuantityString(R.plurals.count, shown.unread, shown.unread);
        if (Store.REAUTH.equals(shown.problem)) return context.getString(R.string.reauth);
        if (!withTime) return count;
        String time = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(shown.fetchedAt);
        if (shown.busy) return count + " · " + context.getString(R.string.refreshing);
        if (Store.OFFLINE.equals(shown.problem)) return count + " · " + context.getString(R.string.offline, time);
        return count + " · " + time;
    }

    private static final String[] DAYS = {"א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"};

    /** Today the hour, yesterday "אתמול", this week the day, before that the date. */
    static String when(long at) {
        if (at <= 0) return "";
        Calendar then = Calendar.getInstance();
        then.setTimeInMillis(at);
        Calendar today = Calendar.getInstance();
        int days = daysBetween(then, today);
        if (days <= 0) return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(at);
        if (days == 1) return "אתמול";
        if (days < 7) return "יום " + DAYS[then.get(Calendar.DAY_OF_WEEK) - 1];
        String pattern = then.get(Calendar.YEAR) == today.get(Calendar.YEAR) ? "d.M" : "d.M.yy";
        return new SimpleDateFormat(pattern, Locale.getDefault()).format(at);
    }

    private static int daysBetween(Calendar from, Calendar to) {
        Calendar a = (Calendar) from.clone();
        Calendar b = (Calendar) to.clone();
        for (Calendar day : new Calendar[] {a, b}) {
            day.set(Calendar.HOUR_OF_DAY, 12);
            day.set(Calendar.MINUTE, 0);
            day.set(Calendar.SECOND, 0);
            day.set(Calendar.MILLISECOND, 0);
        }
        return (int) Math.round((b.getTimeInMillis() - a.getTimeInMillis()) / 86_400_000.0);
    }

    private static PendingIntent open(Context context, String path) {
        Intent intent = new Intent(context, OpenActivity.class).setData(Uri.parse(Doar.SITE + path));
        return PendingIntent.getActivity(context, path.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
