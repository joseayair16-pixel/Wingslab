const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || '';
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || '';

type SendMessageParams = {
  to: string;
  body: string;
};

async function sendViaApi(params: SendMessageParams): Promise<boolean> {
  if (!WHATSAPP_API_KEY || !WHATSAPP_API_URL) return false;
  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WHATSAPP_API_KEY}`,
      },
      body: JSON.stringify({
        to: params.to,
        body: params.body,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendWhatsAppNewOrder(params: {
  restaurantPhone: string;
  restaurantName: string;
  orderReference: string;
  orderId: string;
  customerName: string;
  totalAmount: number;
  panelUrl: string;
}) {
  const message = `🆕 *Nuevo Pedido Recibido*
Restaurante: ${params.restaurantName}
Cliente: ${params.customerName}
Referencia: #${params.orderReference}
Total: $${params.totalAmount.toFixed(2)}

Revisa el pedido aquí:
${params.panelUrl}`;

  const sent = await sendViaApi({
    to: params.restaurantPhone,
    body: message,
  });

  if (!sent) {
    console.log('[WhatsApp Service] Envía manualmente:\n' + message);
  }
}

export async function sendWhatsAppOrderDelivered(params: {
  customerPhone: string;
  customerName: string;
  restaurantName: string;
  orderReference: string;
}) {
  const message = `✅ *Pedido Entregado*

${params.customerName}, tu pedido #${params.orderReference} de *${params.restaurantName}* ha sido entregado.

¡Buen provecho! 🎉`;

  const sent = await sendViaApi({
    to: params.customerPhone,
    body: message,
  });

  if (!sent) {
    console.log('[WhatsApp Service] Envía manualmente:\n' + message);
  }
}
