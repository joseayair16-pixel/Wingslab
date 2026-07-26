import { create } from 'zustand';

interface WebCustomerState {
  // Configuración global
  apiBase: string;
  setApiBase: (url: string) => void;
  
  // Autenticación y Sesión
  token: string;
  setToken: (token: string) => void;
  sessionUser: any | null;
  setSessionUser: (user: any | null) => void;
  isAuthChecked: boolean;
  setIsAuthChecked: (val: boolean) => void;

  // Navegación
  activeSection: 'home' | 'profile' | 'history' | 'support' | 'checkout';
  setActiveSection: (section: 'home' | 'profile' | 'history' | 'support' | 'checkout') => void;

  // UI Global
  toastMessage: string;
  setToastMessage: (msg: string) => void;
  isOnline: boolean;
  setIsOnline: (val: boolean) => void;

  // Búsqueda en Home
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchType: 'restaurant' | 'product';
  setSearchType: (type: 'restaurant' | 'product') => void;
}

export const useStore = create<WebCustomerState>((set) => ({
  apiBase: '/api',
  setApiBase: (url) => set({ apiBase: url }),
  
  token: '',
  setToken: (token) => set({ token }),
  sessionUser: null,
  setSessionUser: (user) => set({ sessionUser: user }),
  isAuthChecked: false,
  setIsAuthChecked: (val) => set({ isAuthChecked: val }),

  activeSection: 'home',
  setActiveSection: (section) => set({ activeSection: section }),

  toastMessage: '',
  setToastMessage: (msg) => {
    set({ toastMessage: msg });
    if (msg) {
      setTimeout(() => set({ toastMessage: '' }), 3000);
    }
  },
  isOnline: true,
  setIsOnline: (val) => set({ isOnline: val }),

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchType: 'restaurant',
  setSearchType: (type) => set({ searchType: type }),
}));
