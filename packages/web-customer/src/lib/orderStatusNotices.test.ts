import { buildOrderAcceptedNotice, buildOrderReadyNotice } from './orderStatusNotices';

const ORDER_ID = 'order-123';

describe('orderStatusNotices — avisos internos del comensal', () => {
  describe('pedido aceptado', () => {
    it('construye el aviso completo con la referencia del pedido', () => {
      expect(buildOrderAcceptedNotice(ORDER_ID, 'SAD-42')).toEqual({
        key: `socket-accepted:${ORDER_ID}`,
        title: '¡Pedido aceptado!',
        description: 'El restaurante confirmó tu pedido #SAD-42 y comenzará a prepararlo.',
        tone: 'success',
        orderId: ORDER_ID,
        orderReference: 'SAD-42',
      });
    });

    it('funciona sin referencia (no deja un "#" colgando)', () => {
      const notice = buildOrderAcceptedNotice(ORDER_ID);
      expect(notice.description).toBe('El restaurante confirmó tu pedido y comenzará a prepararlo.');
      expect(notice.description).not.toContain('#');
      expect(notice.orderReference).toBeUndefined();
    });

    it('la clave es estable por pedido (el dedup de cada vista la reutiliza)', () => {
      expect(buildOrderAcceptedNotice(ORDER_ID).key).toBe(buildOrderAcceptedNotice(ORDER_ID, 'SAD-42').key);
    });

    it('pedidos distintos generan claves distintas (no se come avisos ajenos)', () => {
      expect(buildOrderAcceptedNotice('order-1').key).not.toBe(buildOrderAcceptedNotice('order-2').key);
    });
  });

  describe('pedido listo', () => {
    it('construye el aviso completo con la referencia del pedido', () => {
      expect(buildOrderReadyNotice(ORDER_ID, 'SAD-42')).toEqual({
        key: `socket-ready:${ORDER_ID}`,
        title: '¡Tu pedido está listo!',
        description: 'El restaurante confirmó que tu orden está empacada y lista.',
        tone: 'info',
        orderId: ORDER_ID,
        orderReference: 'SAD-42',
      });
    });

    it('funciona sin referencia', () => {
      const notice = buildOrderReadyNotice(ORDER_ID);
      expect(notice.orderReference).toBeUndefined();
      expect(notice.title).toBe('¡Tu pedido está listo!');
    });
  });

  describe('coherencia entre eventos', () => {
    it('aceptado y listo del mismo pedido no comparten clave', () => {
      expect(buildOrderAcceptedNotice(ORDER_ID).key).not.toBe(buildOrderReadyNotice(ORDER_ID).key);
    });

    it('los tonos están dentro de los soportados por ambas vistas', () => {
      const allowed = ['success', 'danger', 'info'];
      expect(allowed).toContain(buildOrderAcceptedNotice(ORDER_ID).tone);
      expect(allowed).toContain(buildOrderReadyNotice(ORDER_ID).tone);
    });
  });
});
