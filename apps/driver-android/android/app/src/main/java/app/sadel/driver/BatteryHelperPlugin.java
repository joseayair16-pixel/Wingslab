package app.sadel.driver;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre los ajustes de batería / autoinicio del fabricante. Esas opciones
 * (p.ej. "batería sin restricciones" en Xiaomi) son la causa #1 de que las
 * notificaciones no lleguen con la app en segundo plano o cerrada.
 */
@CapacitorPlugin(name = "BatteryHelper")
public class BatteryHelperPlugin extends Plugin {

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            String manufacturer = (Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
            Intent intent = null;

            if (manufacturer.contains("xiaomi")) {
                intent = new Intent("miui.intent.action.OPEN_APP_MANAGE_APPLICATION");
                intent.setData(Uri.parse("miui://extra?packageName=" + getContext().getPackageName()));
            } else if (manufacturer.contains("oppo") || manufacturer.contains("realme")) {
                intent = new Intent("com.coloros.safecenter.startupapp");
                intent.setPackage("com.coloros.safecenter");
                intent.putExtra("packageName", getContext().getPackageName());
            } else if (manufacturer.contains("vivo")) {
                intent = new Intent();
                intent.setClassName("com.iqoo.secure", "com.iqoo.secure.safeguard.SoftwareAppsActivity");
                intent.putExtra("packageName", getContext().getPackageName());
            } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                intent = new Intent("com.huawei.systemmanager.action.START_APP_MANAGER");
                intent.putExtra("packageName", getContext().getPackageName());
            } else if (manufacturer.contains("samsung")) {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            }

            if (getContext().getPackageManager().resolveActivity(intent, 0) != null) {
                getContext().startActivity(intent);
                call.resolve();
                return;
            }

            Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            if (getContext().getPackageManager().resolveActivity(fallback, 0) != null) {
                getContext().startActivity(fallback);
                call.resolve();
            } else {
                call.resolve();
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
