import '../config/env';
import { sendWhatsAppNewOrder } from '../services/whatsapp.service';

const PHONE = process.argv[2] || '4341068932';

async function runTest() {
  const panelBase = (process.env.RESTAURANT_PANEL_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, '');
  const panelUrl = panelBase ? `${panelBase}/?orderId=TEST` : '';

  console.log(`[Test WhatsApp] Enviando plantilla sadel_new_order a ${PHONE}...`);
  console.log(`[Test WhatsApp] Enlace de panel: ${panelUrl || '(vacío — define RESTAURANT_PANEL_URL o WEBAPP_URL)'}`);

  const result = await sendWhatsAppNewOrder({
    restaurantPhone: PHONE,
    orderNumber: 999999,
    panelUrl,
  });

  console.log('[Test WhatsApp] Resultado:', JSON.stringify(result, null, 2));

  if (result.sent) {
    console.log('✅ Mensaje enviado. Revisa el WhatsApp del número de prueba.');
  } else {
    console.log('❌ No se pudo enviar. Revisa los logs del backend y la configuración en Railway.');
  }

  process.exit(result.sent ? 0 : 1);
}

runTest().catch((error) => {
  console.error('[Test WhatsApp] Error en el script:', error);
  process.exit(1);
});
