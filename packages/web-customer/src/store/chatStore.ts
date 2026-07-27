import { create } from 'zustand';

interface ChatMessage {
  id: string;
  content: string;
  senderRole: string;
  senderName: string;
  createdAt: string;
}

interface ChatState {
  isChatOpen: boolean;
  chatMessages: ChatMessage[];
  chatInput: string;
  loadingChat: boolean;
  sendingChatMessage: boolean;
  unreadMessagesMap: Record<string, number>;
  activeOrderId: string | null;

  openChat: (orderId: string) => void;
  closeChat: () => void;
  setChatInput: (input: string) => void;
  setActiveOrderId: (orderId: string | null) => void;
  loadChatMessages: (orderId: string, apiBase: string, token: string) => Promise<void>;
  sendChatMessage: (apiBase: string, token: string) => Promise<{ error?: string }>;
  handleIncomingMessage: (payload: any, currentSelectedOrderId: string | null, isChatOpen: boolean) => { title: string; message: string; id: string } | null;
  clearUnread: (orderId: string) => void;
  getUnreadCount: (orderId: string) => number;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isChatOpen: false,
  chatMessages: [],
  chatInput: '',
  loadingChat: false,
  sendingChatMessage: false,
  unreadMessagesMap: {},
  activeOrderId: null,

  openChat: (orderId) => {
    set({ isChatOpen: true, activeOrderId: orderId });
  },

  closeChat: () => {
    set({ isChatOpen: false, chatMessages: [], chatInput: '', activeOrderId: null });
  },

  setChatInput: (input) => set({ chatInput: input }),

  setActiveOrderId: (orderId) => set({ activeOrderId: orderId }),

  loadChatMessages: async (orderId, apiBase, token) => {
    if (!token) return;
    set({ loadingChat: true });
    try {
      const response = await fetch(`${apiBase}/orders/${orderId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        const unreadMap = { ...get().unreadMessagesMap };
        delete unreadMap[orderId];
        set({ chatMessages: data.messages, unreadMessagesMap: unreadMap });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Error loading chat messages:', err);
      }
    } finally {
      set({ loadingChat: false });
    }
  },

  sendChatMessage: async (apiBase, token) => {
    const state = get();
    if (!token || !state.activeOrderId || !state.chatInput.trim() || state.sendingChatMessage) return {};
    const currentInput = state.chatInput;
    set({ chatInput: '', sendingChatMessage: true });

    try {
      const response = await fetch(`${apiBase}/orders/${state.activeOrderId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content: currentInput }),
      });
      const data = await response.json();
      if (data.success) {
        set((prev) => ({ chatMessages: [...prev.chatMessages, data.message] }));
      } else {
        set({ chatInput: currentInput });
        return { error: 'Error al enviar mensaje' };
      }
    } catch (err) {
      set({ chatInput: currentInput });
      if (process.env.NODE_ENV !== 'production') {
        console.error('Error sending message:', err);
      }
      return { error: 'Error de conexión' };
    } finally {
      set({ sendingChatMessage: false });
    }
    return {};
  },

  handleIncomingMessage: (payload, currentSelectedOrderId, isChatOpen) => {
    const state = get();
    const isCurrentOrder = payload.orderId === currentSelectedOrderId;

    if (isCurrentOrder) {
      set((prev) => {
        if (prev.chatMessages.some((msg) => msg.id === payload.id)) return prev;
        return { chatMessages: [...prev.chatMessages, payload] };
      });

      if (!isChatOpen) {
        set((prev) => ({
          unreadMessagesMap: {
            ...prev.unreadMessagesMap,
            [payload.orderId]: (prev.unreadMessagesMap[payload.orderId] || 0) + 1,
          },
        }));
      }
    } else {
      set((prev) => ({
        unreadMessagesMap: {
          ...prev.unreadMessagesMap,
          [payload.orderId]: (prev.unreadMessagesMap[payload.orderId] || 0) + 1,
        },
      }));
    }

    return {
      title: `Mensaje de ${payload.senderName}`,
      message: payload.content,
      id: payload.id,
    };
  },

  clearUnread: (orderId) => {
    set((prev) => {
      if (!prev.unreadMessagesMap[orderId]) return prev;
      const copy = { ...prev.unreadMessagesMap };
      delete copy[orderId];
      return { unreadMessagesMap: copy };
    });
  },

  getUnreadCount: (orderId) => {
    return get().unreadMessagesMap[orderId] || 0;
  },
}));
