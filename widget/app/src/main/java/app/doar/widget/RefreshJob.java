package app.doar.widget;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Fetching the letters, away from the screen. The phone runs it every quarter of an hour
 * (the shortest it allows) while there is a connection, and at once when ↻ is pressed or
 * the widget was just connected.
 */
public final class RefreshJob extends JobService {
    private static final int EVERY_QUARTER = 1;
    private static final int NOW = 2;

    /** Keep the quarter-hourly refresh going (asking again is harmless). */
    static void schedule(Context context) {
        JobScheduler jobs = context.getSystemService(JobScheduler.class);
        if (jobs.getPendingJob(EVERY_QUARTER) != null) return;
        jobs.schedule(new JobInfo.Builder(EVERY_QUARTER, new ComponentName(context, RefreshJob.class))
                .setPeriodic(15 * 60_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    /** Refresh as soon as there is a connection. */
    static void now(Context context) {
        context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(NOW, new ComponentName(context, RefreshJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
    }

    /**
     * Fetch the letters and draw them, here and now (not on the main thread). Used by the
     * job, by ↻ and by connecting, so a press answers at once instead of waiting in line.
     */
    static void fetch(Context context) {
        Store store = new Store(context);
        String key = store.key();
        if (key == null) {
            Render.all(context);
            return;
        }
        store.setBusy(true);
        Render.all(context);
        Doar.Answer answer = Doar.letters(key);
        Log.i("DoarWidget", "letters: " + answer.status);
        if (answer.status == 200) store.saved(answer.body);
        else if (answer.status == 403) store.forget();
        else if (answer.status == 401) store.failed(Store.REAUTH);
        else store.failed(Store.OFFLINE);
        store.setBusy(false);
        Render.all(context);
    }

    static void stop(Context context) {
        context.getSystemService(JobScheduler.class).cancelAll();
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Context context = getApplicationContext();
        new Thread(() -> {
            fetch(context);
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        new Store(getApplicationContext()).setBusy(false);
        return true;
    }
}
