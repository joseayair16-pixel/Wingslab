package app.sadel.driver;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;

/**
 * Puente entre el panel web y la alarma continua nativa.
 *
 * El panel (que se carga desde la web dentro del WebView) llama a este plugin
 * para silenciar la alarma en cuanto el operador acepta o rechaza el pedido, o
 * cuando la alarma deja de estar activa. Nunca falla la llamada: si algo va
 * mal, el sonido se corta igualmente por la expiración automática.
 */
@CapacitorPlugin(name = "OrderAlarm")
public class OrderAlarmPlugin extends Plugin {

    /**
     * Detiene la alarma de un pedido concreto, o toda la alarma si no se indica
     * `orderId`.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            String orderId = call.getString("orderId");

            if (!OrderAlarmService.isRunning()) {
                call.resolve();
                return;
            }

            Intent intent = new Intent(getContext(), OrderAlarmService.class);
            if (orderId != null && !orderId.isEmpty()) {
                intent.setAction(OrderAlarmService.ACTION_STOP);
                intent.putExtra(OrderAlarmService.EXTRA_ORDER_ID, orderId);
            } else {
                intent.setAction(OrderAlarmService.ACTION_STOP_ALL);
            }

            try {
                getContext().startService(intent);
            } catch (Throwable t) {
                // Si el sistema bloquea el arranque en segundo plano, cortamos todo.
                OrderAlarmService.stopAll(getContext());
            }
            call.resolve();
        } catch (Throwable t) {
            call.resolve();
        }
    }

    /** Estado de la alarma para que el panel sepa si debe mostrar avisos. */
    @PluginMethod
    public void isRinging(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ringing", OrderAlarmService.isRunning());
        call.resolve(result);
    }
}
