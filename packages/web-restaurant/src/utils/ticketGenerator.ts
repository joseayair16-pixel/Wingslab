function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
}

export type TicketPaperWidth = '58mm' | '80mm';

type TicketOptions = {
  /** Ancho del papel térmico. Default 80mm. */
  paperWidth?: TicketPaperWidth;
};

function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'EFECTIVO',
  TRANSFER: 'TRANSFERENCIA',
  CARD: 'TARJETA',
};

/**
 * Plantilla de comanda/ticket térmico profesional:
 * - Sin emojis (las térmicas monocromo los imprimen corruptos).
 * - Separadores con borde dashed real (no hacks de guiones).
 * - Ancho configurable 58/80mm.
 * - Incluye método de pago, notas, entrega programada y total de piezas.
 */
export function generateTicketHtml(
  order: any,
  restaurantName: string,
  dailyCounter?: number,
  options: TicketOptions = {}
) {
  const paperWidth: TicketPaperWidth = options.paperWidth === '58mm' ? '58mm' : '80mm';

  const orderNumber = dailyCounter
    ? `#${String(dailyCounter).padStart(2, '0')}`
    : order.orderReference?.slice(-6) || 'N/A';

  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString('es-MX', {
        dateStyle: 'short',
        timeStyle: 'short',
        hour12: true,
      })
    : new Date().toLocaleString('es-MX');

  const customerName = escapeHtml(order.customer?.user?.name || 'Cliente');
  const customerPhone = escapeHtml(order.customer?.user?.phone || 'Sin teléfono');

  const isDelivery = order.type === 'DELIVERY' || order.fulfillmentType === 'DELIVERY';
  const address = isDelivery
    ? order.address
      ? escapeHtml(
          `${order.address.street || ''} ${order.address.number || order.address.houseNumber || ''}, ${order.address.neighborhood || ''}, ${order.address.city || ''}`.replace(/\s+/g, ' ').trim()
        )
      : 'Sin dirección'
    : null;
  const addressReference = isDelivery && order.address?.reference ? escapeHtml(order.address.reference) : null;

  const paymentLabel = PAYMENT_LABEL[order.paymentMethod] || (order.paymentMethod || '');

  // Entrega programada (si aplica)
  const scheduledRaw = order.scheduledDeliveryAt || order.estimatedDeliveryTime || null;
  const scheduledLabel = scheduledRaw
    ? new Date(scheduledRaw).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', hour12: true })
    : null;

  // Total de piezas y notas
  const items: any[] = Array.isArray(order.items) ? order.items : [];
  const totalUnits = items.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
  const orderNotes = typeof order.notes === 'string' ? order.notes.trim() : '';

  const itemsHtml = items.length > 0
    ? items
        .map((item: any) => {
          const optionsHtml = Array.isArray(item.options) && item.options.length > 0
            ? `<div class="item-sub">${item.options
                .map((opt: any) => `* ${escapeHtml(opt.name)}${opt.price > 0 ? ` (+${formatCurrency(opt.price)})` : ''}`)
                .join('<br>')}</div>`
            : '';
          const instructionsHtml = item.specialInstructions
            ? `<div class="item-note">NOTA: ${escapeHtml(item.specialInstructions)}</div>`
            : '';
          return `
            <div class="item">
              <div class="item-header">
                <span class="item-qty">${escapeHtml(item.quantity)}x</span>
                <span class="item-name">${escapeHtml(item.product?.name || item.name || 'Producto')}</span>
                <span class="item-price">${formatCurrency((item.unitPrice || 0) * (item.quantity || 0))}</span>
              </div>
              ${optionsHtml}
              ${instructionsHtml}
            </div>`;
        })
        .join('')
    : '<div class="item">Sin productos detallados</div>';

  const notesHtml = orderNotes
    ? `<div class="section"><div class="notes">${escapeHtml(orderNotes)}</div></div>`
    : '';

  return `
    <div class="ticket">
      <div class="header">
        <h1 class="restaurant-name">${escapeHtml(restaurantName)}</h1>
        <div class="meta">${escapeHtml(orderDate)}</div>
        <div class="order-type">${isDelivery ? 'ENTREGA A DOMICILIO' : 'PARA RECOGER EN SUCURSAL'}</div>
        <h2 class="order-number">ORDEN ${escapeHtml(orderNumber)}</h2>
      </div>

      <div class="rule"></div>

      <div class="section">
        <div class="row"><span class="label">Cliente:</span> ${customerName}</div>
        <div class="row"><span class="label">Tel:</span> ${customerPhone}</div>
        ${address ? `<div class="row"><span class="label">Dir:</span> ${address}</div>` : ''}
        ${addressReference ? `<div class="row"><span class="label">Ref:</span> ${addressReference}</div>` : ''}
        ${paymentLabel ? `<div class="row"><span class="label">Pago:</span> ${escapeHtml(paymentLabel)}</div>` : ''}
        ${scheduledLabel ? `<div class="row"><span class="label">Entrega:</span> ${escapeHtml(scheduledLabel)}</div>` : ''}
      </div>

      <div class="rule"></div>

      <div class="items">
        ${itemsHtml}
      </div>

      <div class="rule"></div>

      ${notesHtml}
      ${notesHtml ? '<div class="rule"></div>' : ''}

      <div class="totals">
        <div class="totals-row"><span>Piezas:</span><span>${totalUnits}</span></div>
        <div class="totals-row"><span>Subtotal:</span><span>${formatCurrency(order.subtotal || 0)}</span></div>
        ${Number(order.promoDiscountAmount || 0) > 0 ? `<div class="totals-row"><span>Descuento:</span><span>-${formatCurrency(Number(order.promoDiscountAmount))}</span></div>` : ''}
        <div class="totals-row"><span>Envío:</span><span>${formatCurrency(order.deliveryFee || 0)}</span></div>
        <div class="totals-row grand-total"><span>TOTAL:</span><span>${formatCurrency(order.totalAmount || 0)}</span></div>
      </div>

      <div class="rule"></div>

      <div class="footer">
        <p>SaDeL Punto de Venta</p>
        <p>Gracias por su preferencia</p>
      </div>
    </div>
    <style>
      @page { margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        background-color: #fff;
        color: #000;
        font-family: 'Courier New', Courier, monospace;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .ticket {
        width: ${paperWidth};
        max-width: 100%;
        margin: 0 auto;
        padding: 8px 4px;
        box-sizing: border-box;
      }
      .header { text-align: center; }
      .restaurant-name {
        font-size: ${paperWidth === '58mm' ? '14px' : '16px'};
        font-weight: bold;
        margin: 0 0 2px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .meta { font-size: 11px; margin-bottom: 4px; }
      .order-type {
        font-weight: bold;
        font-size: 12px;
        padding: 3px 0;
        margin: 2px 0;
        border-top: 1px dashed #000;
        border-bottom: 1px dashed #000;
        letter-spacing: 0.5px;
      }
      .order-number {
        font-size: ${paperWidth === '58mm' ? '20px' : '24px'};
        font-weight: bold;
        margin: 4px 0 0 0;
        letter-spacing: 1px;
      }
      .rule { border-top: 1px dashed #000; margin: 6px 0; }
      .section { font-size: 11px; }
      .row { margin: 2px 0; line-height: 1.35; }
      .label { font-weight: bold; }
      .items { font-size: 12px; }
      .item { margin-bottom: 6px; }
      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 4px;
      }
      .item-qty {
        font-weight: bold;
        font-size: 14px;
        min-width: 26px;
      }
      .item-name { flex: 1; font-weight: bold; line-height: 1.2; }
      .item-price { font-weight: bold; text-align: right; white-space: nowrap; }
      .item-sub { font-size: 11px; padding-left: 26px; margin-top: 1px; }
      .item-note {
        font-size: 11px;
        padding-left: 26px;
        margin-top: 2px;
        font-weight: bold;
        text-transform: uppercase;
      }
      .notes {
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        line-height: 1.3;
      }
      .totals { font-size: 12px; }
      .totals-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .grand-total {
        font-size: ${paperWidth === '58mm' ? '14px' : '16px'};
        font-weight: bold;
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px dashed #000;
      }
      .footer { text-align: center; font-size: 10px; margin-top: 10px; }
      .footer p { margin: 2px 0; }
    </style>
  `;
}
