const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || '';
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || '';
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';

const NEW_ORDER_TEMPLATE = 'sadel_new_order';
const PAYMENT_REMINDER_TEMPLATE = 'sadel_pago_recordatorio';
const PAYMENT_SUSPENDED_TEMPLATE = 'sadel_cuenta_suspendida';
const THANK_YOU_TEMPLATE = 'sadel_gracias_comensal';
const TEMPLATE_LANGUAGE = 'es_MX';

type SendMessageParams = {
  to: string;
  body: string;
};

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  return `+${digits}`;
}

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

async function sendTemplateViaCloudApi(params: {
  to: string;
  templateName: string;
  bodyParameters: string[];
}): Promise<boolean> {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error(
      '[WhatsApp Cloud API] No configurado: define WHATSAPP_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID en el entorno.',
    );
    return false;
  }
  if (params.bodyParameters.some((p) => !p || /\{\{\d\}\}/.test(p))) {
    console.error('[WhatsApp Cloud API] Parámetros de plantilla inválidos/vacíos.', params.bodyParameters);
    return false;
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: toE164(params.to),
          type: 'template',
          template: {
            name: params.templateName,
            language: { code: TEMPLATE_LANGUAGE },
            components: [
              {
                type: 'body',
                parameters: params.bodyParameters.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      }
    );
    if (!response.ok) {
      console.error('[WhatsApp Cloud API]', response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('[WhatsApp Cloud API] Exception', error);
    return false;
  }
}

export interface WhatsAppSendResult {
  sent: boolean;
  channel: 'template' | 'legacy' | 'manual';
  error?: string;
}

export async function sendWhatsAppNewOrder(params: {
  restaurantPhone: string;
  orderNumber: number;
  panelUrl: string;
}): Promise<WhatsAppSendResult> {
  if (!/^https?:\/\//i.test(params.panelUrl)) {
    console.error(
      '[WhatsApp] panelUrl inválido. Revisa RESTAURANT_PANEL_URL / WEBAPP_URL en el entorno.',
    );
  }

  const sent = await sendTemplateViaCloudApi({
    to: params.restaurantPhone,
    templateName: NEW_ORDER_TEMPLATE,
    bodyParameters: [String(params.orderNumber), params.panelUrl],
  });

  if (sent) return { sent: true, channel: 'template' };

  const message = `🆕 *Nuevo Pedido Recibido*
Folio: #${params.orderNumber}

Revisa el pedido aquí:
${params.panelUrl}`;

  const legacySent = await sendViaApi({
    to: params.restaurantPhone,
    body: message,
  });

  if (legacySent) return { sent: true, channel: 'legacy' };

  console.log('[WhatsApp Service] No se pudo enviar automáticamente. Envía manualmente:\n' + message);
  return { sent: false, channel: 'manual' };
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

export async function sendWhatsAppPaymentReminder(params: {
  restaurantPhone: string;
  restaurantName: string;
  reference: string;
  balanceUrl: string;
}): Promise<WhatsAppSendResult> {
  if (!/^https?:\/\//i.test(params.balanceUrl)) {
    console.error('[WhatsApp] balanceUrl inválido. Revisa RESTAURANT_PANEL_URL en el entorno.');
  }

  const sent = await sendTemplateViaCloudApi({
    to: params.restaurantPhone,
    templateName: PAYMENT_REMINDER_TEMPLATE,
    bodyParameters: [params.restaurantName, params.reference, params.balanceUrl],
  });

  if (sent) return { sent: true, channel: 'template' };

  const message = `💳 *Recordatorio de pago*

Hola ${params.restaurantName}, te recordamos amablemente que el corte *${params.reference}* sigue pendiente.

Realiza tu pago para evitar restricciones en tu cuenta. Puedes liquidar y subir tu comprobante aquí:
${params.balanceUrl}`;

  console.log('[WhatsApp Service] No se pudo enviar automáticamente. Envía manualmente:\n' + message);
  return { sent: false, channel: 'manual' };
}

export async function sendWhatsAppPaymentSuspended(params: {
  restaurantPhone: string;
  restaurantName: string;
  reference: string;
  balanceUrl: string;
}): Promise<WhatsAppSendResult> {
  if (!/^https?:\/\//i.test(params.balanceUrl)) {
    console.error('[WhatsApp] balanceUrl inválido. Revisa RESTAURANT_PANEL_URL en el entorno.');
  }

  const sent = await sendTemplateViaCloudApi({
    to: params.restaurantPhone,
    templateName: PAYMENT_SUSPENDED_TEMPLATE,
    bodyParameters: [params.restaurantName, params.reference, params.balanceUrl],
  });

  if (sent) return { sent: true, channel: 'template' };

  const message = `🚫 *Cuenta suspendida temporalmente*

Hola ${params.restaurantName}, tu cuenta por el momento no puede recibir pedidos.

Una vez que liquides el saldo del corte *${params.reference}* tendrás acceso total con normalidad.

Paga o sube tu comprobante aquí:
${params.balanceUrl}`;

  console.log('[WhatsApp Service] No se pudo enviar automáticamente. Envía manualmente:\n' + message);
  return { sent: false, channel: 'manual' };
}

export async function sendWhatsAppThankYou(params: {
  customerPhone: string;
  customerName: string;
  orderReference: string;
}): Promise<WhatsAppSendResult> {
  const sent = await sendTemplateViaCloudApi({
    to: params.customerPhone,
    templateName: THANK_YOU_TEMPLATE,
    bodyParameters: [params.customerName, params.orderReference],
  });

  if (sent) return { sent: true, channel: 'template' };

  const message = `🎉 *¡Gracias por tu pedido!*

Hola ${params.customerName}, gracias por tu compra #${params.orderReference} con SaDeL.

Esperamos que hayas tenido una buena experiencia y gracias por confiar en nosotros. ¡Te esperamos de vuelta! 😊`;

  console.log('[WhatsApp Service] No se pudo enviar automáticamente. Envía manualmente:\n' + message);
  return { sent: false, channel: 'manual' };
}
