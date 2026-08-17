import React, { memo, useState, useEffect } from 'react';
import { useStore } from '../store';
import { Search, X } from 'lucide-react';

export const RestaurantSearchBar = memo(function RestaurantSearchBar() {
  const globalQuery = useStore((state) => state.searchQuery);
  const setGlobalQuery = useStore((state) => state.setSearchQuery);
  const searchType = useStore((state) => state.searchType);
  const setSearchType = useStore((state) => state.setSearchType);
  const [localQuery, setLocalQuery] = useState(globalQuery);

  // Debounce the global search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setGlobalQuery(localQuery);
    }, 350);
    return () => clearTimeout(timer);
  }, [localQuery, setGlobalQuery]);

  // Sync local query if global query changes from outside (e.g. from the other search bar)
  useEffect(() => {
    if (globalQuery !== localQuery) {
      setLocalQuery(globalQuery);
    }
  }, [globalQuery]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="relative w-full">
        <input
          type="text"
          placeholder="Buscar en SaDeL"
          value={localQuery}
          onChange={(event) => setLocalQuery(event.target.value)}
          className="w-full rounded-full border border-black/10 bg-white px-5 py-3 pr-11 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-black/20"
        />
        {localQuery ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setLocalQuery('');
              setGlobalQuery('');
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 transition-colors rounded-full hover:bg-neutral-100"
            aria-label="Limpiar búsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={1.8} />
        )}
      </div>

      {/* Selector de Tipo de Búsqueda */}
      {localQuery.trim() && (
        <div className="flex gap-1 p-1 bg-white rounded-full border border-black/5 shadow-inner">
          <button
            type="button"
            onClick={() => setSearchType('restaurant')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-bold rounded-full transition-all duration-300 ease-out ${
              searchType === 'restaurant'
                ? 'bg-accent text-white shadow-md scale-100'
                : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50 scale-[0.98]'
            }`}
          >
            <span className="text-sm">🏪</span> Negocios
          </button>
          <button
            type="button"
            onClick={() => setSearchType('product')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-bold rounded-full transition-all duration-300 ease-out ${
              searchType === 'product'
                ? 'bg-accent text-white shadow-md scale-100'
                : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50 scale-[0.98]'
            }`}
          >
            <span className="text-sm">🍔</span> Productos
          </button>
        </div>
      )}
    </div>
  );
});
