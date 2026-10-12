import {
  buildOrderIntentSignature,
  hashOrderSignature,
  orderIntentFromRequestBody,
} from './orderIntent';

const baseBody = {
  restaurantId: 'rest-1',
  items: [
    { productId: 'p1', quantity: 2, optionIds: ['o2', 'o1'] },
    { productId: 'p2', quantity: 1, specialInstructions: ' sin sal ' },
  ],
  fulfillmentType: 'DELIVERY',
  paymentMethod: 'CASH',
  notes: ' tocar timbre ',
  deliveryAddress: {
    street: 'Av 1',
    number: '10',
    apartment: '3B',
    neighborhood: 'Centro',
    city: 'CDMX',
    state: 'CDMX',
    zipCode: '06000',
    country: 'MX',
    latitude: 19.43,
    longitude: -99.13,
  },
};

describe('orderIntent — identidad de intentos de compra', () => {
  it('el mismo contenido produce la misma firma', () => {
    const a = buildOrderIntentSignature(orderIntentFromRequestBody(baseBody));
    const b = buildOrderIntentSignature(orderIntentFromRequestBody({ ...baseBody }));
    expect(a).toBe(b);
  });

  it('el orden de items y de opciones no altera la firma', () => {
    const a = buildOrderIntentSignature(orderIntentFromRequestBody(baseBody));
    const reordered = buildOrderIntentSignature(
      orderIntentFromRequestBody({
        ...baseBody,
        items: [
          { productId: 'p2', quantity: 1, specialInstructions: 'sin sal' },
          { productId: 'p1', quantity: 2, optionIds: ['o1', 'o2'] },
        ],
      })
    );
    expect(reordered).toBe(a);
  });

  it('el orden de claves de la dirección y los campos volátiles no alteran la firma', () => {
    const a = buildOrderIntentSignature(orderIntentFromRequestBody(baseBody));
    const reshuffled = buildOrderIntentSignature(
      orderIntentFromRequestBody({
        ...baseBody,
        deliveryAddress: {
          country: 'MX',
          zipCode: '06000',
          city: 'CDMX',
          state: 'CDMX',
          apartment: '3B',
          number: '10',
          street: 'Av 1',
          neighborhood: 'Centro',
          // Campos volátiles: no deben formar parte de la identidad del pedido.
          latitude: 1.234,
          longitude: -45.6,
        },
      })
    );
    expect(reshuffled).toBe(a);
  });

  it('cualquier cambio real genera una firma distinta', () => {
    const base = buildOrderIntentSignature(orderIntentFromRequestBody(baseBody));
    const variants: Array<Record<string, unknown>> = [
      { restaurantId: 'rest-2' },
      { fulfillmentType: 'PICKUP' },
      { paymentMethod: 'TRANSFER' },
      { notes: 'otro texto' },
      { promoCode: 'PROMO10' },
      { items: [{ productId: 'p1', quantity: 3, optionIds: ['o2', 'o1'] }, { productId: 'p2', quantity: 1, specialInstructions: 'sin sal' }] },
      { items: [{ productId: 'p1', quantity: 2, optionIds: ['o1'] }, { productId: 'p2', quantity: 1, specialInstructions: 'sin sal' }] },
      { items: [{ productId: 'p1', quantity: 2, optionIds: ['o2', 'o1'], weightG: 500 }, { productId: 'p2', quantity: 1, specialInstructions: 'sin sal' }] },
      { deliveryAddress: { ...baseBody.deliveryAddress, apartment: '4A' } },
      { deliveryAddress: { ...baseBody.deliveryAddress, street: 'Av 2' } },
    ];
    for (const variant of variants) {
      expect(buildOrderIntentSignature(orderIntentFromRequestBody({ ...baseBody, ...variant }))).not.toBe(base);
    }
  });

  it('recogida (sin dirección) y con dirección no son el mismo intento', () => {
    const pickup = buildOrderIntentSignature(
      orderIntentFromRequestBody({ ...baseBody, fulfillmentType: 'PICKUP', deliveryAddress: undefined })
    );
    const delivery = buildOrderIntentSignature(orderIntentFromRequestBody(baseBody));
    expect(pickup).not.toBe(delivery);
  });

  it('el hash es determinista y no expone el contenido', () => {
    const signature = buildOrderIntentSignature(orderIntentFromRequestBody(baseBody));
    const h1 = hashOrderSignature(signature);
    expect(hashOrderSignature(signature)).toBe(h1);
    expect(h1).not.toContain('rest-1');
    expect(h1).not.toContain('p1');
    expect(/^\d+\.[0-9a-z]+$/.test(h1)).toBe(true);
  });

  it('tolera bodies vacíos o incompletos sin lanzar', () => {
    expect(() => buildOrderIntentSignature(orderIntentFromRequestBody(null))).not.toThrow();
    expect(() => buildOrderIntentSignature(orderIntentFromRequestBody({}))).not.toThrow();
    expect(buildOrderIntentSignature(orderIntentFromRequestBody({ items: [] }))).toBe(
      buildOrderIntentSignature(orderIntentFromRequestBody({}))
    );
  });
});