package app.sadel.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Alarma continua de pedidos (Foreground Service).
 *
 * Android solo permite reproducir un sonido largo y detenible desde un
 * Foreground Service: una notificación normal suena una vez por canal y no se
 * puede cortar. Este servicio mantiene el sonido en bucle y muestra UNA única
 * notificación "en curso" mientras haya pedidos sin resolver.
 *
 * El servicio es idempotente: recibe varias acciones de inicio (por ejemplo el
 * push del backend y la reconciliación cada 3 s) y mantiene un conjunto de
 * pedidos sonando; cuando ese conjunto queda vacío se detiene a sí mismo.
 * Además cada pedido trae `expiresAt`, por lo que la alarma se apaga sola al
 * terminar la ventana de decisión aunque el push de parada nunca llegue.
 */
public class OrderAlarmService extends Service {

    public static final String ACTION_START = "app.sadel.driver.ORDER_ALARM_START";
    public static final String ACTION_STOP = "app.sadel.driver.ORDER_ALARM_STOP";
    public static final String ACTION_STOP_ALL = "app.sadel.driver.ORDER_ALARM_STOP_ALL";

    public static final String EXTRA_ORDER_ID = "orderId";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_SOUND = "sound";
    public static final String EXTRA_EXPIRES_AT = "expiresAt";

    public static final String CHANNEL_ID = "order-alarm";

    private static final String TAG = "SaDelAlarm";
    private static final int NOTIFICATION_ID = 7101;

    /** Si el backend no envía expiración, la alarma dura lo que la ventana por defecto. */
    private static final long DEFAULT_DURATION_MS = 2 * 60 * 1000L;
    /** Tope de seguridad: nunca sonar más de 15 min seguidos. */
    private static final long MAX_DURATION_MS = 15 * 60 * 1000L;

    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    /** Detiene la alarma completa desde cualquier contexto (siempre permitido). */
    public static void stopAll(Context context) {
        try {
            context.stopService(new Intent(context, OrderAlarmService.class));
        } catch (Throwable ignored) {
        }
    }

    private static class Ring {
        String title;
        String body;
        String sound;
        long expiresAt;
        Runnable stopTask;
    }

    /** Solo se usa desde el hilo principal (onStartCommand y los timers). */
    private final Map<String, Ring> rings = new LinkedHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private MediaPlayer mediaPlayer;
    private String currentSound;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP_ALL.equals(action)) {
            finish();
            return START_NOT_STICKY;
        }

        if (ACTION_STOP.equals(action)) {
            String orderId = readString(intent, EXTRA_ORDER_ID);
            if (orderId.isEmpty()) {
                finish();
            } else {
                stopOrder(orderId);
            }
            return START_NOT_STICKY;
        }

        // ACTION_START (o intent nulo por reinicio del sistema).
        String orderId = readString(intent, EXTRA_ORDER_ID);
        long expiresAt = readLong(intent, EXTRA_EXPIRES_AT);

        if (orderId.isEmpty()) {
            // Sin identificador no hay nada que silenciar después: se apaga.
            finish();
            return START_NOT_STICKY;
        }

        if (expiresAt <= 0L) {
            expiresAt = System.currentTimeMillis() + DEFAULT_DURATION_MS;
        }
        long maxExpiry = System.currentTimeMillis() + MAX_DURATION_MS;
        if (expiresAt > maxExpiry) {
            expiresAt = maxExpiry;
        }
        if (expiresAt <= System.currentTimeMillis()) {
            // Ventana ya vencida (push tardío): no reproducir.
            finish();
            return START_NOT_STICKY;
        }

        Ring ring = new Ring();
        ring.title = readString(intent, EXTRA_TITLE);
        ring.body = readString(intent, EXTRA_BODY);
        ring.sound = readString(intent, EXTRA_SOUND);
        ring.expiresAt = expiresAt;

        Ring previous = rings.get(orderId);
        if (previous != null && previous.stopTask != null) {
            handler.removeCallbacks(previous.stopTask);
        }
        // Reemplaza manteniendo el orden de inserción (LinkedHashMap.put no altera el orden).
        rings.put(orderId, ring);
        scheduleStop(orderId, expiresAt);

        ensureForeground();
        ensureAlarmSound(ring.sound);
        updateNotification();

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        for (Ring ring : rings.values()) {
            if (ring.stopTask != null) {
                handler.removeCallbacks(ring.stopTask);
            }
        }
        rings.clear();
        releasePlayer();
        handler.removeCallbacksAndMessages(null);
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── Sonido ──────────────────────────────────────────────────────────────

    private void ensureAlarmSound(String sound) {
        String wanted = (sound == null || sound.trim().isEmpty()) ? "notifica" : sound.trim();
        if (mediaPlayer != null && wanted.equals(currentSound)) {
            if (!mediaPlayer.isPlaying()) {
                mediaPlayer.start();
            }
            return;
        }

        releasePlayer();
        try {
            int resId = soundResId(wanted);
            Uri uri = Uri.parse("android.resource://" + getPackageName() + "/" + resId);
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
            );
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
            mediaPlayer = player;
            currentSound = wanted;
        } catch (Throwable t) {
            Log.e(TAG, "No se pudo reproducir el sonido de alarma", t);
            mediaPlayer = null;
            currentSound = null;
        }
    }

    private int soundResId(String sound) {
        if ("llegue".equals(sound)) return R.raw.llegue;
        if ("rezagado".equals(sound)) return R.raw.rezagado;
        if ("mensaje".equals(sound)) return R.raw.mensaje;
        return R.raw.notifica;
    }

    private void releasePlayer() {
        if (mediaPlayer == null) return;
        try {
            if (mediaPlayer.isPlaying()) {
                mediaPlayer.stop();
            }
        } catch (Throwable ignored) {
        }
        try {
            mediaPlayer.release();
        } catch (Throwable ignored) {
        }
        mediaPlayer = null;
        currentSound = null;
    }

    // ── Notificación ─────────────────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;
            // Canal silencioso: el sonido lo produce el MediaPlayer en bucle, así
            // que el canal no debe sonar ni vibrar por su cuenta.
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Alarma de pedidos", NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Aviso persistente mientras hay un pedido sin resolver");
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.enableLights(false);
            channel.setShowBadge(true);
            manager.createNotificationChannel(channel);
        } catch (Throwable t) {
            Log.e(TAG, "No se pudo crear el canal de alarma", t);
        }
    }

    private Notification buildNotification(Ring ring) {
        String title = (ring != null && !ring.title.isEmpty()) ? ring.title : "Nuevo pedido";
        String body = (ring != null && !ring.body.isEmpty())
                ? ring.body
                : "Toca para aceptar el pedido.";

        Intent open = new Intent();
        open.setClassName(this, MainActivity.class.getName());
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_sadel)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(pendingIntent)
                .build();
    }

    private void ensureForeground() {
        Ring ring = firstRing();
        Notification notification = buildNotification(ring);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Throwable t) {
            Log.e(TAG, "startForeground falló; se detiene la alarma", t);
            finish();
        }
    }

    private void updateNotification() {
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;
            manager.notify(NOTIFICATION_ID, buildNotification(firstRing()));
        } catch (Throwable t) {
            Log.e(TAG, "No se pudo actualizar la notificación", t);
        }
    }

    private Ring firstRing() {
        for (Ring ring : rings.values()) {
            return ring;
        }
        return null;
    }

    // ── Control ──────────────────────────────────────────────────────────────

    private void scheduleStop(String orderId, long expiresAt) {
        Ring ring = rings.get(orderId);
        if (ring == null) return;
        if (ring.stopTask != null) {
            handler.removeCallbacks(ring.stopTask);
        }
        long delay = Math.max(0L, expiresAt - System.currentTimeMillis());
        ring.stopTask = new Runnable() {
            @Override
            public void run() {
                stopOrder(orderId);
            }
        };
        handler.postDelayed(ring.stopTask, delay);
    }

    private void stopOrder(String orderId) {
        Ring ring = rings.remove(orderId);
        if (ring != null && ring.stopTask != null) {
            handler.removeCallbacks(ring.stopTask);
        }
        if (rings.isEmpty()) {
            finish();
        } else {
            updateNotification();
        }
    }

    private void finish() {
        handler.removeCallbacksAndMessages(null);
        rings.clear();
        releasePlayer();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Throwable ignored) {
        }
        try {
            stopSelf();
        } catch (Throwable ignored) {
        }
        running = false;
    }

    private static String readString(Intent intent, String key) {
        if (intent == null) return "";
        try {
            String value = intent.getStringExtra(key);
            return value == null ? "" : value;
        } catch (Throwable t) {
            return "";
        }
    }

    private static long readLong(Intent intent, String key) {
        if (intent == null) return 0L;
        try {
            return intent.getLongExtra(key, 0L);
        } catch (Throwable t) {
            return 0L;
        }
    }
}
