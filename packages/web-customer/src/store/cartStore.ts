import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartItemOption = {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  price: number;
};

export type CartItem = {
  cartItemId: string;
  productId: string;
  name: string;
  price: number;
  discountPrice?: number | null;
  image?: string | null;
  quantity: number;
  specialInstructions: string;
  selectedOptions?: CartItemOption[];
  sellBy?: string;
  weightG?: number | null;
  unitPrice?: number | null;
};

type CartState = {
  restaurantId: string | null;
  serviceFee: number;
  deliveryFee: number;
  items: CartItem[];
  
  // Actions
  addItem: (item: CartItem, restaurantId: string, serviceFee?: number, deliveryFee?: number) => void;
  updateItem: (cartItemId: string, patch: Partial<Pick<CartItem, 'quantity' | 'specialInstructions'>>) => void;
  decreaseQuantity: (productId: string) => void;
  clearCart: () => void;
  setCart: (items: CartItem[], restaurantId: string, deliveryFee?: number) => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      restaurantId: null,
      serviceFee: 0,
      deliveryFee: 0,
      items: [],

      addItem: (item, newRestaurantId, newServiceFee = 0, newDeliveryFee = 0) => {
        const { restaurantId, items } = get();

        // Si es una tienda diferente, reiniciamos el carrito
        if (restaurantId && restaurantId !== newRestaurantId) {
          set({
            restaurantId: newRestaurantId,
            serviceFee: newServiceFee,
            deliveryFee: newDeliveryFee,
            items: [item],
          });
          return;
        }

        // Misma tienda, intentamos agrupar
        const existingIndex = items.findIndex((i) => {
          if (i.productId !== item.productId) return false;

          const currentOpts = (i.selectedOptions || []).map(o => o.id).sort().join(',');
          const newOpts = (item.selectedOptions || []).map(o => o.id).sort().join(',');
          if (currentOpts !== newOpts) return false;

          if ((i.weightG || null) !== (item.weightG || null)) return false;

          return true;
        });

        if (existingIndex >= 0) {
          const newItems = [...items];
          newItems[existingIndex] = {
            ...newItems[existingIndex],
            quantity: newItems[existingIndex].quantity + item.quantity,
            specialInstructions: item.specialInstructions || newItems[existingIndex].specialInstructions,
          };
          set({ items: newItems, restaurantId: newRestaurantId, serviceFee: newServiceFee, deliveryFee: newDeliveryFee });
        } else {
          set({
            items: [...items, item],
            restaurantId: newRestaurantId,
            serviceFee: newServiceFee,
            deliveryFee: newDeliveryFee,
          });
        }
      },

      updateItem: (cartItemId, patch) => {
        set((state) => ({
          items: state.items
            .map((item) =>
              item.cartItemId === cartItemId
                ? { ...item, ...patch }
                : item
            )
            .filter((item) => item.quantity > 0),
        }));
      },

      decreaseQuantity: (productId) => {
        set((state) => {
          const itemsOfProduct = state.items.filter((item) => item.productId === productId);
          if (itemsOfProduct.length === 0) return state;
          
          const lastItem = itemsOfProduct[itemsOfProduct.length - 1];
          return {
            items: state.items
              .map((item) =>
                item.cartItemId === lastItem.cartItemId
                  ? { ...item, quantity: item.quantity - 1 }
                  : item
              )
              .filter((item) => item.quantity > 0)
          };
        });
      },

      clearCart: () => {
        set({ items: [], restaurantId: null, serviceFee: 0, deliveryFee: 0 });
      },

      setCart: (items, restaurantId, deliveryFee = 0) => {
        set({ items, restaurantId, deliveryFee });
      },
    }),
    {
      name: 'sadel-cart-storage',
    }
  )
);
