/**
 * Regresión: el checkout se mostraba vacío ("Agrega al menos un producto", $0)
 * porque refreshItemPrices podaba items al abrir el checkout cuando el stock
 * fresco era bajo/0. El refresco de precios NUNCA debe eliminar ni reducir a 0
 * unidades que ya están en el carrito, solo actualizar precio y techo de stock.
 */
// Stub de localStorage: el store usa zustand/persist y jest corre en node.
const memoryStorage: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => memoryStorage[k] ?? null,
    setItem: (k: string, v: string) => { memoryStorage[k] = String(v); },
    removeItem: (k: string) => { delete memoryStorage[k]; },
    clear: () => { Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]); },
  },
  writable: true,
  configurable: true,
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useCartStore } = require('./cartStore') as typeof import('./cartStore');

const baseItem = {
  cartItemId: 'item-1',
  productId: 'prod-1',
  name: 'Producto de prueba',
  price: 45,
  quantity: 2,
  specialInstructions: '',
};

describe('cartStore.refreshItemPrices (no destructivo)', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], restaurantId: null, serviceFee: 0, deliveryFee: 0 });
  });

  it('no elimina items aunque el stock fresco sea 0', () => {
    useCartStore.getState().setCart([baseItem as any], 'rest-1');

    useCartStore.getState().refreshItemPrices([
      { productId: 'prod-1', price: 45, maxStock: 0 },
    ]);

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].maxStock).toBe(0);
  });

  it('actualiza el precio sin tocar la cantidad', () => {
    useCartStore.getState().setCart([baseItem as any], 'rest-1');

    useCartStore.getState().refreshItemPrices([
      { productId: 'prod-1', price: 60, discountPrice: 50, maxStock: 10 },
    ]);

    const items = useCartStore.getState().items;
    expect(items[0].price).toBe(60);
    expect(items[0].discountPrice).toBe(50);
    expect(items[0].quantity).toBe(2);
  });

  it('no reduce cantidad aunque el stock fresco sea menor que la cantidad', () => {
    useCartStore.getState().setCart([{ ...baseItem, quantity: 5 } as any], 'rest-1');

    useCartStore.getState().refreshItemPrices([
      { productId: 'prod-1', price: 45, maxStock: 1 },
    ]);

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });
});
