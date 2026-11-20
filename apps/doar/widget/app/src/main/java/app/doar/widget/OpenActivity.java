package app.doar.widget;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;

/**
 * A tap on the widget, on its way to Doar. Doar installed from Chrome is an app of its own
 * (a "WebAPK"); when it is there, the link goes straight to it, so the letter opens in the
 * Doar window and not in a browser tab.
 */
public final class OpenActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri link = getIntent().getData();
        if (link == null) link = Uri.parse(Doar.SITE);
        Intent view = new Intent(Intent.ACTION_VIEW, link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String installed = installedDoar(view);
        if (installed != null) view.setPackage(installed);
        try {
            startActivity(view);
        } catch (ActivityNotFoundException error) {
            startActivity(new Intent(Intent.ACTION_VIEW, link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        finish();
    }

    private String installedDoar(Intent view) {
        for (ResolveInfo app : getPackageManager().queryIntentActivities(view, PackageManager.MATCH_ALL)) {
            String name = app.activityInfo.packageName;
            if (name.startsWith("org.chromium.webapk.")) return name;
        }
        return null;
    }
}
