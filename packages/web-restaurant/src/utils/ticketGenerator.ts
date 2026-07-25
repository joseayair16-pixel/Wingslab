function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
}

export function generateTicketHtml(order: any, restaurantName: string, dailyCounter?: number) {
  const orderNumber = dailyCounter
    ? `#${String(dailyCounter).padStart(2, '0')}`
    : order.orderReference?.slice(-6) || 'N/A';

  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
      hour12: true
    })
    : new Date().toLocaleString('es-MX');

  const customerName = order.customer?.user?.name || 'Cliente';
  const customerPhone = order.customer?.user?.phone || 'Sin teléfono';

  const isDelivery = order.type === 'DELIVERY';
  const address = isDelivery && order.address
    ? `${order.address.street} ${order.address.houseNumber || ''}, ${order.address.neighborhood || ''}, ${order.address.city || ''}`
    : 'PARA RECOGER EN SUCURSAL';

  const itemsHtml = order.items && order.items.length > 0
    ? order.items.map((item: any) => {
      let optionsHtml = '';
      if (item.options && item.options.length > 0) {
        optionsHtml = item.options.map((opt: any) =>
          `<div class="item-option">✦ ${opt.name} ${opt.price > 0 ? `(+${formatCurrency(opt.price)})` : ''}</div>`
        ).join('');
      }

      let instructionsHtml = '';
      if (item.specialInstructions) {
        instructionsHtml = `<div class="item-instructions">🚨 ${item.specialInstructions}</div>`;
      }

      return `
          <div class="item">
            <div class="item-header">
              <span class="item-qty">${item.quantity}x</span>
              <span class="item-name">${item.product?.name || 'Producto'}</span>
              <span class="item-price">${formatCurrency(item.unitPrice * item.quantity)}</span>
            </div>
            ${optionsHtml}
            ${instructionsHtml}
          </div>
        `;
    }).join('')
    : '<div class="item">Sin productos detallados</div>';

  return `
    <div class="ticket">
      <div class="header">
        <h1 class="restaurant-name">${restaurantName}</h1>
        <div class="date-time">${orderDate}</div>
        <div class="order-type ${isDelivery ? 'delivery' : 'pickup'}">
          ${isDelivery ? '🛵 DOMICILIO' : '🏃 PARA LLEVAR'}
        </div>
        <h2 class="order-number">ORDEN ${orderNumber}</h2>
      </div>

      <div class="divider">--------------------------------</div>

      <div class="customer-info">
        <div class="customer-name">👤 ${customerName}</div>
        <div class="customer-phone">📞 ${customerPhone}</div>
        <div class="customer-address">📍 ${address}</div>
      </div>

      <div class="divider">--------------------------------</div>

      <div class="items">
        ${itemsHtml}
      </div>

      <div class="divider">--------------------------------</div>

      <div class="totals">
        <div class="totals-row">
          <span>Subtotal:</span>
          <span>${formatCurrency(order.subtotal || 0)}</span>
        </div>
        <div class="totals-row">
          <span>Envío:</span>
          <span>${formatCurrency(order.deliveryFee || 0)}</span>
        </div>
        <div class="totals-row grand-total">
          <span>TOTAL:</span>
          <span>${formatCurrency(order.totalAmount || 0)}</span>
        </div>
      </div>

      <div class="divider">--------------------------------</div>
      
      <div class="footer">
        <p>SaDeL Punto de Venta</p>
        <p>¡Gracias por su preferencia!</p>
      </div>
    </div>
    <style>
      @page {
        margin: 0;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: 'Courier New', Courier, monospace; /* Classic receipt font */
        color: #000;
        background-color: #fff;
        width: 100%;
        max-width: 80mm; /* Standard thermal printer width */
      }
      .ticket {
        padding: 10px 5px;
        width: 100%;
        box-sizing: border-box;
      }
      .header {
        text-align: center;
        margin-bottom: 10px;
      }
      .restaurant-name {
        font-size: 1.2rem;
        font-weight: bold;
        margin: 0 0 5px 0;
        text-transform: uppercase;
      }
      .date-time {
        font-size: 0.8rem;
        margin-bottom: 5px;
      }
      .order-type {
        font-weight: bold;
        font-size: 1rem;
        margin: 5px 0;
        padding: 3px 0;
        border-top: 1px dashed #000;
        border-bottom: 1px dashed #000;
      }
      .order-number {
        font-size: 1.5rem;
        font-weight: bold;
        margin: 5px 0 0 0;
      }
      .divider {
        text-align: center;
        font-size: 0.8rem;
        letter-spacing: -1px;
        margin: 5px 0;
        overflow: hidden;
        white-space: nowrap;
      }
      .customer-info {
        font-size: 0.9rem;
        margin: 10px 0;
        line-height: 1.3;
      }
      .customer-name { font-weight: bold; }
      .customer-address { margin-top: 3px; font-weight: bold; }
      .items {
        margin: 10px 0;
      }
      .item {
        margin-bottom: 8px;
        font-size: 0.9rem;
      }
      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .item-qty {
        font-weight: bold;
        min-width: 25px;
      }
      .item-name {
        flex: 1;
        font-weight: bold;
        padding-right: 5px;
      }
      .item-price {
        font-weight: bold;
        text-align: right;
      }
      .item-option {
        font-size: 0.8rem;
        padding-left: 25px;
        margin-top: 2px;
      }
      .item-instructions {
        font-size: 0.85rem;
        padding-left: 25px;
        margin-top: 3px;
        font-weight: bold;
        text-transform: uppercase;
      }
      .totals {
        margin: 10px 0;
        font-size: 0.9rem;
      }
      .totals-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 3px;
      }
      .grand-total {
        font-size: 1.2rem;
        font-weight: bold;
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px dashed #000;
      }
      .footer {
        text-align: center;
        font-size: 0.8rem;
        margin-top: 15px;
      }
      .footer p { margin: 2px 0; }
    </style>
  `;
}
