// Avisos internos del comensal ante cambios de estado de su pedido.
//
// Fuente única del contenido (título, descripción y tono) para "pedido
// aceptado" y "pedido listo": la usan tanto el inicio como la página del
// restaurante, de modo que el comensal recibe el mismo aviso esté donde esté
// y el texto no puede divergir entre vistas.
//
// Solo construyen el CONTENIDO del aviso; el sonido, la vibración y la
// presentación (transient del inicio o de la página) los decide cada vista.
// La clave es estable por (evento, pedido): repetir el mismo evento no
// duplica el aviso gracias al dedup por clave de cada vista.

export type OrderStatusNoticeTone = 'success' | 'danger' | 'info';

export type OrderStatusNotice = {
  key: string;
  title: string;
  description: string;
  tone: OrderStatusNoticeTone;
  orderId: string;
  orderReference?: string;
};

function referenceSuffix(orderReference?: string): string {
  return orderReference ? ` #${orderReference}` : '';
}

/**
 * Aviso de "pedido aceptado" (el restaurante confirmó y empezará a preparar).
 * Antes no existía como aviso visible: el evento solo entraba en silencio al
 * centro de notificaciones y el comensal en otra sección lo perdía de vista.
 */
export function buildOrderAcceptedNotice(orderId: string, orderReference?: string): OrderStatusNotice {
  return {
    key: `socket-accepted:${orderId}`,
    title: '¡Pedido aceptado!',
    description: `El restaurante confirmó tu pedido${referenceSuffix(orderReference)} y comenzará a prepararlo.`,
    tone: 'success',
    orderId,
    orderReference,
  };
}

/**
 * Aviso de "pedido listo" para delivery (o cuando el detalle no confirma
 * recogida en tienda, que usa su propio modal). Antes esta rama quedaba en
 * silencio fuera del inicio.
 */
export function buildOrderReadyNotice(orderId: string, orderReference?: string): OrderStatusNotice {
  return {
    key: `socket-ready:${orderId}`,
    title: '¡Tu pedido está listo!',
    description: 'El restaurante confirmó que tu orden está empacada y lista.',
    tone: 'info',
    orderId,
    orderReference,
  };
}
