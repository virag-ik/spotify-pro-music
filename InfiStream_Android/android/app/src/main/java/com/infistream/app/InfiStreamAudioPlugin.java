package com.infistream.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

@UnstableApi
@CapacitorPlugin(name = "InfiStreamAudio")
public class InfiStreamAudioPlugin extends Plugin {
    private MediaController mediaController;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private Runnable progressRunnable;

    @Override
    public void load() {
        super.load();
        initMediaController();
        startProgressUpdater();
    }

    private void initMediaController() {
        Context context = getContext();
        Intent intent = new Intent(context, InfiStreamPlaybackService.class);
        context.startService(intent);

        SessionToken sessionToken = new SessionToken(context, new ComponentName(context, InfiStreamPlaybackService.class));
        ListenableFuture<MediaController> controllerFuture = new MediaController.Builder(context, sessionToken).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                mediaController = controllerFuture.get();
                setupPlayerListener();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, MoreExecutors.directExecutor());
    }

    private void setupPlayerListener() {
        if (mediaController == null) return;

        mediaController.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                if (mediaItem != null && mediaItem.mediaMetadata != null) {
                    JSObject ret = new JSObject();
                    ret.put("title", String.valueOf(mediaItem.mediaMetadata.title));
                    ret.put("artist", String.valueOf(mediaItem.mediaMetadata.artist));
                    ret.put("album", String.valueOf(mediaItem.mediaMetadata.albumTitle));
                    ret.put("mediaId", mediaItem.mediaId);
                    notifyListeners("trackChanged", ret);
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject ret = new JSObject();
                ret.put("isPlaying", isPlaying);
                notifyListeners("playbackStateChanged", ret);
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                JSObject ret = new JSObject();
                ret.put("isPlaying", mediaController.isPlaying());
                ret.put("isBuffering", playbackState == Player.STATE_BUFFERING);
                ret.put("isEnded", playbackState == Player.STATE_ENDED);
                notifyListeners("playbackStateChanged", ret);
            }
        });
    }

    private void startProgressUpdater() {
        progressRunnable = new Runnable() {
            @Override
            public void run() {
                if (mediaController != null && mediaController.isPlaying()) {
                    JSObject ret = new JSObject();
                    ret.put("position", mediaController.getCurrentPosition());
                    ret.put("duration", mediaController.getDuration());
                    notifyListeners("positionUpdated", ret);
                }
                progressHandler.postDelayed(this, 1000);
            }
        };
        progressHandler.post(progressRunnable);
    }

    @PluginMethod
    public void play(PluginCall call) {
        String streamUrl = call.getString("streamUrl");
        String title = call.getString("title", "Unknown Track");
        String artist = call.getString("artist", "InfiStream Artist");
        String album = call.getString("album", "InfiStream");
        String artworkUrl = call.getString("artworkUrl", "");
        String mediaId = call.getString("mediaId", "");

        if (streamUrl == null || streamUrl.isEmpty()) {
            call.reject("streamUrl is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (mediaController == null) {
                call.reject("MediaController not initialized");
                return;
            }

            MediaMetadata.Builder metadataBuilder = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setAlbumTitle(album);

            if (!artworkUrl.isEmpty()) {
                metadataBuilder.setArtworkUri(Uri.parse(artworkUrl));
            }

            MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(Uri.parse(streamUrl))
                    .setMediaId(mediaId)
                    .setMediaMetadata(metadataBuilder.build())
                    .build();

            mediaController.setMediaItem(mediaItem);
            mediaController.prepare();
            mediaController.play();

            JSObject ret = new JSObject();
            ret.put("status", "playing");
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void queueNext(PluginCall call) {
        String streamUrl = call.getString("streamUrl");
        String title = call.getString("title", "Next Track");
        String artist = call.getString("artist", "InfiStream Artist");
        String album = call.getString("album", "InfiStream");
        String artworkUrl = call.getString("artworkUrl", "");
        String mediaId = call.getString("mediaId", "");

        if (streamUrl == null || streamUrl.isEmpty()) {
            call.reject("streamUrl is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (mediaController == null) {
                call.reject("MediaController not initialized");
                return;
            }

            MediaMetadata.Builder metadataBuilder = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setAlbumTitle(album);

            if (!artworkUrl.isEmpty()) {
                metadataBuilder.setArtworkUri(Uri.parse(artworkUrl));
            }

            MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(Uri.parse(streamUrl))
                    .setMediaId(mediaId)
                    .setMediaMetadata(metadataBuilder.build())
                    .build();

            // Adds directly to ExoPlayer's native playlist queue for gapless background playback
            mediaController.addMediaItem(mediaItem);

            JSObject ret = new JSObject();
            ret.put("status", "queued");
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (mediaController != null) {
                mediaController.pause();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (mediaController != null) {
                mediaController.play();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Long positionMs = call.getLong("positionMs", 0L);
        getActivity().runOnUiThread(() -> {
            if (mediaController != null) {
                mediaController.seekTo(positionMs);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        Integer mode = call.getInt("mode", Player.REPEAT_MODE_OFF);
        getActivity().runOnUiThread(() -> {
            if (mediaController != null) {
                mediaController.setRepeatMode(mode);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setShuffleMode(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            if (mediaController != null) {
                mediaController.setShuffleModeEnabled(enabled);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        if (mediaController == null) {
            call.reject("MediaController not ready");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("isPlaying", mediaController.isPlaying());
        ret.put("position", mediaController.getCurrentPosition());
        ret.put("duration", mediaController.getDuration());
        call.resolve(ret);
    }

    @PluginMethod
    public void playYouTube(PluginCall call) {
        String videoId = call.getString("videoId");
        String title = call.getString("title", "YouTube Track");
        String artist = call.getString("artist", "YouTube Artist");
        String album = call.getString("album", "InfiStream Music");
        String artworkUrl = call.getString("artworkUrl", "");

        if (videoId == null || videoId.isEmpty()) {
            call.reject("videoId is required");
            return;
        }

        new Thread(() -> {
            String resolvedStreamUrl = resolveYouTubeStreamUrl(videoId);
            getActivity().runOnUiThread(() -> {
                if (mediaController == null) {
                    call.reject("MediaController not ready");
                    return;
                }

                if (resolvedStreamUrl != null && !resolvedStreamUrl.isEmpty()) {
                    MediaMetadata.Builder metadataBuilder = new MediaMetadata.Builder()
                            .setTitle(title)
                            .setArtist(artist)
                            .setAlbumTitle(album);

                    if (!artworkUrl.isEmpty()) {
                        metadataBuilder.setArtworkUri(Uri.parse(artworkUrl));
                    }

                    MediaItem mediaItem = new MediaItem.Builder()
                            .setUri(Uri.parse(resolvedStreamUrl))
                            .setMediaId(videoId)
                            .setMediaMetadata(metadataBuilder.build())
                            .build();

                    mediaController.setMediaItem(mediaItem);
                    mediaController.prepare();
                    mediaController.play();

                    JSObject ret = new JSObject();
                    ret.put("status", "playing");
                    ret.put("streamUrl", resolvedStreamUrl);
                    call.resolve(ret);
                } else {
                    call.reject("Could not resolve mobile stream URL for YouTube video: " + videoId);
                }
            });
        }).start();
    }

    private String resolveYouTubeStreamUrl(String videoId) {
        try {
            java.net.URL url = new java.net.URL("https://www.youtube.com/youtubei/v1/player");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", "com.google.android.youtube/19.29.37 (Linux; U; Android 14; en_US; Pixel 8 Pro) gzip");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setDoOutput(true);

            org.json.JSONObject client = new org.json.JSONObject();
            client.put("clientName", "ANDROID");
            client.put("clientVersion", "19.29.37");
            client.put("androidSdkVersion", 34);
            client.put("hl", "en");
            client.put("gl", "US");

            org.json.JSONObject context = new org.json.JSONObject();
            context.put("client", client);

            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("context", context);
            payload.put("videoId", videoId);

            byte[] out = payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            try (java.io.OutputStream os = conn.getOutputStream()) {
                os.write(out);
            }

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                java.io.InputStream is = conn.getInputStream();
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is, java.nio.charset.StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                org.json.JSONObject data = new org.json.JSONObject(sb.toString());
                org.json.JSONObject sd = data.optJSONObject("streamingData");
                if (sd != null) {
                    org.json.JSONArray adaptive = sd.optJSONArray("adaptiveFormats");
                    if (adaptive != null) {
                        for (int i = 0; i < adaptive.length(); i++) {
                            org.json.JSONObject fmt = adaptive.getJSONObject(i);
                            String mime = fmt.optString("mimeType", "");
                            if (mime.contains("audio")) {
                                String streamUrl = fmt.optString("url", "");
                                if (!streamUrl.isEmpty()) {
                                    return streamUrl;
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }
}
