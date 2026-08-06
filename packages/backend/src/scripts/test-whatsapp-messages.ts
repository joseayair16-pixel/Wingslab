import {
  sendWhatsAppPaymentReminder,
  sendWhatsAppPaymentSuspended,
  sendWhatsAppThankYou,
} from '../services/whatsapp.service';

async function main() {
  const target = process.argv[2] || '4341068932';
  const balanceUrl = ((process.env.RESTAURANT_PANEL_URL || '').replace(/\/+$/, '')) + '/?section=billing';

  console.log(`[Test WhatsApp Messages] Destino: ${target}`);
  console.log(`[Test WhatsApp Messages] Balance URL: ${balanceUrl}`);

  console.log('\n--- 1. Recordatorio de pago ---');
  const r1 = await sendWhatsAppPaymentReminder({
    restaurantPhone: target,
    restaurantName: 'Prueba Tortas Sadel',
    reference: 'CRT-260806-ABC123',
    balanceUrl,
  });
  console.log('Resultado:', JSON.stringify(r1));

  console.log('\n--- 2. Cuenta suspendida ---');
  const r2 = await sendWhatsAppPaymentSuspended({
    restaurantPhone: target,
    restaurantName: 'Prueba Tortas Sadel',
    reference: 'CRT-260802-ABC123',
    balanceUrl,
  });
  console.log('Resultado:', JSON.stringify(r2));

  console.log('\n--- 3. Agradecimiento al comensal ---');
  const r3 = await sendWhatsAppThankYou({
    customerPhone: target,
    customerName: 'Comensal de Prueba',
    orderReference: '12345',
  });
  console.log('Resultado:', JSON.stringify(r3));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
