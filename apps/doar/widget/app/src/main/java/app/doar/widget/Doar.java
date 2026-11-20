package app.doar.widget;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONException;
import org.json.JSONObject;

/** Where Doar lives, and the one question the widget asks its server. */
final class Doar {
    static final String SITE = "https://doar-henna.vercel.app/";
    private static final String SERVER = "https://krdelzkqlisgmvdbqdru.supabase.co/functions/v1/postman";

    private Doar() {}

    /** The server's answer: its HTTP status and body (status 0 when it could not be reached). */
    static final class Answer {
        final int status;
        final String body;

        Answer(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    /** Ask for the latest letters in the inbox (see supabase/functions/postman/widget.ts). */
    static Answer letters(String key) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(SERVER).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(20_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] request = new JSONObject().put("action", "widget").put("key", key).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(request);
            }
            int status = connection.getResponseCode();
            InputStream in = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            return new Answer(status, in == null ? "" : read(in));
        } catch (IOException | JSONException error) {
            android.util.Log.w("DoarWidget", "no answer: " + error);
            return new Answer(0, "");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (in) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
            return bytes.toString(StandardCharsets.UTF_8);
        }
    }
}
