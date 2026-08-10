import Image from 'next/image';
import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { StoreCategoryItem } from '../app/page';
import { BillboardCarousel, type Billboard } from '../components/BillboardCarousel';

const isRestaurantType = (type?: string | null) => !type || type === 'RESTAURANT';

type BusinessTypeTab = 'restaurants' | 'stores' | 'all';

interface HomeViewProps {
  selectedCategory: string;
  setSelectedCategory: (id: string) => void;
  restaurants: any[];
  featuredRestaurants?: any[];
  offerProducts?: any[];
  filteredRestaurants: any[];
  formatRegionChipLabel: (region: string) => string;
  platformCategories: StoreCategoryItem[];
  activeCategories?: Array<{ id: string; businessTypes: string[] }>;
  Panel: React.FC<any>;
  EmptyState: React.FC<any>;
  loadingDashboard: boolean;
  isSearchingProducts: boolean;
  filterNearby: boolean;
  setFilterNearby: (val: boolean) => void;
  filterOpenNow: boolean;
  setFilterOpenNow: (val: boolean) => void;
  filterFreeDelivery: boolean;
  setFilterFreeDelivery: (val: boolean) => void;
  filterPromotions: boolean;
  setFilterPromotions: (val: boolean) => void;
  filterBestRated: boolean;
  setFilterBestRated: (val: boolean) => void;
  router: any;
  buildRestaurantCoverFallback: (categoryId: string) => string;
  buildRestaurantInitials: (name: string) => string;
  formatDeliverySummary: (distance: any) => string;
  activeZones?: any[];
  selectedZoneName?: string | null;
  onZoneSelect?: (zone: any) => void;
  onResetZone?: () => void;
  onJoinClick?: () => void;
  hasMoreRestaurants?: boolean;
  onLoadMoreRestaurants?: () => void;
  loadingMoreRestaurants?: boolean;
  billboards?: Billboard[];
}

export const HomeView = React.memo(function HomeView({
  selectedCategory,
  setSelectedCategory,
  restaurants,
  featuredRestaurants = [],
  offerProducts = [],
  filteredRestaurants,
  formatRegionChipLabel,
  platformCategories,
  activeCategories = [],
  Panel,
  EmptyState,
  loadingDashboard,
  isSearchingProducts,
  filterNearby,
  setFilterNearby,
  filterOpenNow,
  setFilterOpenNow,
  filterFreeDelivery,
  setFilterFreeDelivery,
  filterPromotions,
  setFilterPromotions,
  filterBestRated,
  setFilterBestRated,
  router,
  buildRestaurantCoverFallback,
  buildRestaurantInitials,
  formatDeliverySummary,
  activeZones = [],
  selectedZoneName,
  onZoneSelect,
  onResetZone,
  onJoinClick,
  hasMoreRestaurants = false,
  onLoadMoreRestaurants,
  loadingMoreRestaurants = false,
  billboards = [],
}: HomeViewProps) {
  const searchQuery = useStore(state => state.searchQuery);
  const searchType = useStore(state => state.searchType);
  const activeSection = useStore(state => state.activeSection);

  const [businessTypeFilter, setBusinessTypeFilter] = useState<BusinessTypeTab>('all');

  const filteredOfferProducts = useMemo(() => {
    if (businessTypeFilter === 'all') return offerProducts;
    return offerProducts.filter((g: any) => {
      const isRest = isRestaurantType(g.restaurant.businessType);
      return businessTypeFilter === 'restaurants' ? isRest : !isRest;
    });
  }, [offerProducts, businessTypeFilter]);

  // When searching, default to searching everything (both restaurants and stores)
  const [prevBusinessTypeFilter, setPrevBusinessTypeFilter] = useState<BusinessTypeTab>('all');
  const isSearching = searchQuery.trim().length > 0;
  React.useEffect(() => {
    if (isSearching) {
      setPrevBusinessTypeFilter(businessTypeFilter);
      setBusinessTypeFilter('all');
    } else {
      setBusinessTypeFilter(prevBusinessTypeFilter);
    }
  }, [isSearching]);

  const categoryBusinessTypes = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    if (activeCategories.length > 0) {
      for (const c of activeCategories) {
        map[c.id] = new Set(c.businessTypes);
      }
      return map;
    }
    for (const r of restaurants) {
      const bt = (r as any).businessType;
      const cats = (r as any).storeCategories;
      if (cats) {
        for (const c of cats) {
          if (!map[c.id]) map[c.id] = new Set();
          map[c.id].add(bt || 'RESTAURANT');
        }
      }
    }
    return map;
  }, [activeCategories, restaurants]);

  const filteredByBusinessType = useMemo(() => {
    return filteredRestaurants.filter((r) => {
      const bt = (r as any).businessType;
      if (businessTypeFilter === 'restaurants') return isRestaurantType(bt);
      if (businessTypeFilter === 'stores') return !isRestaurantType(bt);
      return true;
    });
  }, [filteredRestaurants, businessTypeFilter]);

  const filteredCategories = useMemo(() => {
    // Solo mostrar categorías que al menos un restaurante/tienda tiene asignada.
    const available = platformCategories.filter((c) => {
      const types = categoryBusinessTypes[c.id];
      return !!types && types.size > 0;
    });
    if (businessTypeFilter === 'all') return available;
    return available.filter((c) => {
      const types = categoryBusinessTypes[c.id];
      const hasRestaurant = [...types].some(t => isRestaurantType(t));
      const hasStore = [...types].some(t => !isRestaurantType(t));
      if (businessTypeFilter === 'restaurants') return hasRestaurant;
      if (businessTypeFilter === 'stores') return hasStore;
      return true;
    });
  }, [platformCategories, categoryBusinessTypes, businessTypeFilter]);

  const displayTitle = businessTypeFilter === 'restaurants'
    ? 'Restaurantes disponibles'
    : businessTypeFilter === 'stores'
      ? 'Tiendas disponibles'
      : 'Restaurantes y tiendas';

  // ── Billboard placement logic (Uber Eats style) ──────────────────────────
  // Visible only with the base tabs (Todos / Restaurantes / Tiendas) and no
  // other active filter: no category, no search, no "filtrar por" chips.
  const isBillboardFilterBlocked =
    selectedCategory !== 'all' ||
    isSearching ||
    filterOpenNow ||
    filterFreeDelivery ||
    filterPromotions ||
    filterBestRated;

  const visibleBillboards = !isBillboardFilterBlocked ? billboards : [];

  // Position within the grid:
  //   n <= 10  -> middle (10 -> after the 5th)
  //   n >  10  -> quarter (16 -> after the 4th)
  const billboardInsertIndex = useMemo(() => {
    const n = filteredByBusinessType.length;
    if (visibleBillboards.length === 0 || n === 0) return -1;
    if (n <= 10) return Math.ceil(n / 2);
    return Math.floor(n / 4);
  }, [filteredByBusinessType.length, visibleBillboards.length]);

  // When the computed position lands beyond the last item (e.g. n=1 -> pos 1),
  // clamp the in-grid insertion and render the carousel after the grid instead.
  const billboardAfterGrid =
    billboardInsertIndex > 0 &&
    billboardInsertIndex >= filteredByBusinessType.length;

  const handleBillboardNavigate = React.useCallback((url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (url.startsWith('/')) {
      router.push(url);
    } else if (url) {
      router.push(`/restaurantes/${url}`);
    }
  }, [router]);

  const highlightText = (text: string, highlight: string) => {
    if (!highlight.trim()) {
      return <span>{text}</span>;
    }
    const regex = new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-sky-100 text-sky-950 rounded-[4px] px-0.5 font-semibold">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  const tabs: { key: BusinessTypeTab; label: string; icon: string }[] = [
    { key: 'all', label: 'Todo', icon: '📋' },
    { key: 'restaurants', label: 'Restaurantes', icon: '🍽️' },
    { key: 'stores', label: 'Tiendas', icon: '🏪' },
  ];

  return (
    <>
      <div className="space-y-4">
        {/* Business type selector — hidden when searching, defaults to 'all' */}
        {!isSearching && (
        <section className="-mx-4 border-y border-black/5 bg-white px-4 py-3 shadow-[0_18px_60px_rgba(15,15,15,0.05)] md:mx-0 md:rounded-[32px] md:border md:border-black/5 md:px-6 md:py-3">
          <div className="flex justify-center gap-4 md:gap-5">
            {tabs.map((tab) => {
              const isActive = businessTypeFilter === tab.key;
              const imgSrc = tab.key === 'restaurants' ? '/restaurantes.png' : tab.key === 'stores' ? '/tiendas.png' : '/todos.png';
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setBusinessTypeFilter(tab.key);
                    setSelectedCategory('all');
                  }}
                   className={`relative rounded-lg md:rounded-xl transition-all active:scale-[0.97] max-w-[80px] md:max-w-[100px] ${
                    isActive ? '' : 'opacity-40 grayscale hover:opacity-70 hover:grayscale-[50%]'
                  }`}
                >
                  <Image
                    src={imgSrc}
                    alt={tab.label}
                    width={500}
                    height={350}
                    className="w-full h-auto"
                    priority
                  />
                </button>
              );
            })}
          </div>
        </section>
        )}

        {/* Category selector */}
        <section className="-mx-4 rounded-none border-y border-black/5 bg-white px-4 py-3 shadow-[0_18px_60px_rgba(15,15,15,0.05)] md:mx-0 md:rounded-[24px] md:border md:border-black/5 md:px-5 md:py-3">
          <div className="-mx-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max gap-1.5 sm:gap-2">
              {[{ id: 'all', name: 'Todo', icon: businessTypeFilter === 'stores' ? '🏪' : businessTypeFilter === 'all' ? '📋' : '🍽️', keywords: [], isActive: true, order: 0 } as StoreCategoryItem, ...filteredCategories].map((category) => {
                const isActive = selectedCategory === category.id;

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                    className={`group flex w-[56px] flex-col items-center gap-1 transition-all duration-300 active:scale-[0.94] sm:w-[66px] md:w-[76px] ${isActive ? '-translate-y-0.5' : ''}`}
                  >
                    <span className={`flex h-11 w-11 items-center justify-center rounded-[16px] text-[18px] leading-none transition-all duration-300 sm:h-12 sm:w-12 sm:rounded-[18px] sm:text-[20px] md:h-14 md:w-14 md:rounded-[20px] md:text-[22px] ${isActive
                      ? 'bg-gradient-to-br from-sky-400 via-sky-500 to-sky-600 text-white shadow-[0_10px_24px_rgba(56,189,248,0.4)]'
                      : 'bg-neutral-100 text-neutral-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] group-hover:bg-neutral-200 group-hover:text-neutral-700 group-hover:scale-105'
                      }`}
                    >
                      {category.icon}
                    </span>
                    <span className={`w-full truncate text-[10px] font-semibold leading-3 transition-colors duration-300 sm:text-[11px] md:text-xs ${isActive ? 'text-sky-700' : 'text-neutral-600 group-hover:text-neutral-900'}`}>
                      {category.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {featuredRestaurants && featuredRestaurants.length > 0 && (
          <section className="-mx-4 md:mx-0">
            <div className="px-4 md:px-0 mb-3">
              <h2 className="text-xl font-black text-neutral-900">Restaurantes Destacados</h2>
            </div>
            <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-4 px-4 md:px-0 min-w-max">
                {featuredRestaurants.map((fr: any) => (
                  <button key={fr.id} onClick={() => router.push(`/restaurantes/${fr.id}`)}
                    className="group relative w-72 shrink-0 overflow-hidden rounded-[30px] border border-black/5 bg-white text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:border-black/10 hover:shadow-[0_24px_60px_rgba(15,15,15,0.08)] active:scale-[0.98]">
                    <div className="relative overflow-hidden h-40 sm:h-44">
                      <Image
                        src={fr.coverImage || '/default-cover.jpg'}
                        alt={`Portada de ${fr.name}`}
                        fill
                        sizes="288px"
                        className="object-cover transition duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4 z-10 pointer-events-none">
                        <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs font-bold text-sky-700 shadow-sm pointer-events-auto">
                          <span className="text-sm leading-none">⭐</span>
                          <span>Destacado</span>
                        </div>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
                    </div>
                    <div className="relative px-4 pb-4 pt-4">
                      <div className="mb-3 flex items-end gap-3">
                        <div className="-mt-11 flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-[0_10px_24px_rgba(15,15,15,0.14)] relative">
                          {fr.logo ? (
                            <Image
                              src={fr.logo}
                              alt={`Logo de ${fr.name}`}
                              fill
                              sizes="64px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="h-full w-full bg-neutral-200 flex items-center justify-center text-lg font-bold text-neutral-500">{fr.name?.[0]}</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-xl font-bold tracking-tight text-neutral-900">{fr.name}</h3>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-neutral-600">
                            <span className={`flex items-center gap-1 ${fr.isOpen ? 'text-emerald-600' : 'text-red-500'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${fr.isOpen ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              {fr.isOpen ? 'Abierto' : 'Cerrado'}
                            </span>
                            {fr.rating > 0 && (
                              <span className="flex items-center gap-0.5 font-semibold text-neutral-900">
                                <span>⭐</span>
                                {fr.rating.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {filteredOfferProducts && filteredOfferProducts.length > 0 && (
          <section className="-mx-4 md:mx-0">
            <div className="px-4 md:px-0 mb-3 flex items-center justify-between">
              <h2 className="text-xl font-black text-neutral-900">🔥 Ofertas imperdibles</h2>
              <span className="text-xs font-bold text-rose-500">{filteredOfferProducts.length} productos</span>
            </div>
            <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-3 px-4 md:px-0 min-w-max">
                {filteredOfferProducts.map((item: any) => {
                  const { product, restaurant } = item;
                  return (
                    <button key={product.id} onClick={() => router.push(`/restaurantes/${restaurant.id}?focusProduct=${product.id}`)}
                      className="group w-28 sm:w-44 shrink-0 overflow-hidden rounded-[18px] border border-black/5 bg-white text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:border-black/10 hover:shadow-[0_12px_30px_rgba(15,15,15,0.08)] active:scale-[0.98]">
                        <div className="relative overflow-hidden h-20 sm:h-24">
                          {product.image ? (
                            <Image
                              src={product.image}
                              alt={product.name}
                              fill
                              sizes="(max-width:640px) 112px, 176px"
                              className="object-cover transition duration-300 group-hover:scale-105"
                            />
                        ) : (
                          <div className="h-20 sm:h-24 w-full bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center">
                            <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-3" />
                            </svg>
                          </div>
                        )}
                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-rose-500/90 backdrop-blur-sm rounded-full px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                          <span>-{product.discountPercent}%</span>
                        </div>
                      </div>
                      <div className="px-2 pb-2 pt-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          {restaurant.logo && (
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm relative">
                              <Image src={restaurant.logo} alt={restaurant.name} fill sizes="20px" className="object-cover" />
                            </div>
                          )}
                          <p className="text-[9px] font-bold text-neutral-500 truncate">{restaurant.name}</p>
                        </div>
                        <h3 className="text-xs font-bold text-neutral-900 truncate leading-tight">{product.name}</h3>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-sm font-black text-rose-600">${product.discountPrice.toFixed(2)}</span>
                          <span className="text-[10px] font-medium text-neutral-400 line-through">${product.price.toFixed(2)}</span>
                        </div>
                        <div className="mt-0.5">
                          <span className="text-[9px] font-bold text-sky-600 bg-sky-50 rounded-full px-1.5 py-0.5">Ahorras ${product.savings.toFixed(2)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <Panel
          title={displayTitle}
          subtitle=""
          aside={loadingDashboard ? 'Actualizando' : `${filteredByBusinessType.length} resultados`}
          className="-mx-4 rounded-none border-x-0 px-4 md:mx-0 md:rounded-[32px] md:border-x md:px-6"
        >
          <details className="group rounded-2xl border border-black/5 bg-white p-4 mb-4">
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-neutral-900">Filtrar por:</span>
                <div className="flex gap-1.5 flex-wrap">
                  {filterOpenNow && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-soft text-sky-800 border border-accent/10">Abierto ahora</span>
                  )}
                  {filterNearby && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-soft text-sky-800 border border-accent/10">Cerca de mí</span>
                  )}
                  {filterFreeDelivery && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-soft text-sky-800 border border-accent/10">Envío gratis</span>
                  )}
                  {filterPromotions && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-soft text-sky-800 border border-accent/10">Promociones</span>
                  )}
                  {filterBestRated && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-soft text-sky-800 border border-accent/10">Mejor valorado</span>
                  )}
                </div>
              </div>
              <svg className="w-5 h-5 text-neutral-500 transition group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 mt-4 flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
              <button
                type="button"
                onClick={() => setFilterNearby(!filterNearby)}
                className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold border transition-all active-scale flex items-center gap-1.5 ${filterNearby
                  ? 'bg-accent text-sky-950 border-transparent shadow-[0_2px_10px_rgba(135,206,235,0.4)]'
                  : 'bg-white text-neutral-700 border-black/5 hover:bg-neutral-50'
                  }`}
              >
                <span>📍</span>
                Cerca de mí
              </button>
              <button
                type="button"
                onClick={() => setFilterOpenNow(!filterOpenNow)}
                className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold border transition-all active-scale flex items-center gap-1.5 ${filterOpenNow
                  ? 'bg-accent text-sky-950 border-transparent shadow-[0_2px_10px_rgba(135,206,235,0.4)]'
                  : 'bg-white text-neutral-700 border-black/5 hover:bg-neutral-50'
                  }`}
              >
                <span>🟢</span>
                Abierto ahora
              </button>
              <button
                type="button"
                onClick={() => setFilterFreeDelivery(!filterFreeDelivery)}
                className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold border transition-all active-scale flex items-center gap-1.5 ${filterFreeDelivery
                  ? 'bg-accent text-sky-950 border-transparent shadow-[0_2px_10px_rgba(135,206,235,0.4)]'
                  : 'bg-white text-neutral-700 border-black/5 hover:bg-neutral-50'
                  }`}
              >
                <span>🛵</span>
                Envío gratis
              </button>
              <button
                type="button"
                onClick={() => setFilterPromotions(!filterPromotions)}
                className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold border transition-all active-scale flex items-center gap-1.5 ${filterPromotions
                  ? 'bg-accent text-sky-950 border-transparent shadow-[0_2px_10px_rgba(135,206,235,0.4)]'
                  : 'bg-white text-neutral-700 border-black/5 hover:bg-neutral-50'
                  }`}
              >
                <span>🎁</span>
                Promociones activas
              </button>
              <button
                type="button"
                onClick={() => setFilterBestRated(!filterBestRated)}
                className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold border transition-all active-scale flex items-center gap-1.5 ${filterBestRated
                  ? 'bg-accent text-sky-950 border-transparent shadow-[0_2px_10px_rgba(135,206,235,0.4)]'
                  : 'bg-white text-neutral-700 border-black/5 hover:bg-neutral-50'
                  }`}
              >
                <span>⭐</span>
                Mejor valorado
              </button>
            </div>
          </details>

          {(loadingDashboard || isSearchingProducts) ? (
            /* ──────── SKELETON LOADERS ──────── */
            searchQuery.trim().length >= 3 && searchType === 'product' ? (
              /* Product search skeletons: compact cards */
              <div className="space-y-4">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-[24px] border border-black/5 bg-white animate-pulse">
                    <div className="flex items-center gap-3 p-4">
                      <div className="h-12 w-12 rounded-2xl bg-neutral-200 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-neutral-200 rounded-full w-2/3" />
                        <div className="h-3 bg-neutral-200 rounded-full w-1/2" />
                      </div>
                    </div>
                    <div className="border-t border-black/5 p-4 space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-neutral-200 shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-neutral-200 rounded-full w-3/4" />
                          <div className="h-2.5 bg-neutral-200 rounded-full w-1/2" />
                        </div>
                        <div className="h-4 w-12 bg-neutral-200 rounded-full" />
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-neutral-200 shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-neutral-200 rounded-full w-2/3" />
                          <div className="h-2.5 bg-neutral-200 rounded-full w-1/3" />
                        </div>
                        <div className="h-4 w-10 bg-neutral-200 rounded-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Restaurant search / dashboard skeletons: full cards */
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[...Array(5)].map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-[30px] border bg-white p-4 animate-pulse">
                    <div className="h-40 w-full bg-neutral-200 rounded-[22px] sm:h-44" />
                    <div className="mt-4 space-y-3">
                      <div className="h-5 bg-neutral-200 rounded-full w-3/4" />
                      <div className="h-4 bg-neutral-200 rounded-full w-1/2" />
                      <div className="flex gap-2">
                        <div className="h-4 bg-neutral-200 rounded-full w-1/4" />
                        <div className="h-4 bg-neutral-200 rounded-full w-1/4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : filteredByBusinessType.length ? (
            /* ──────── PRODUCT SEARCH LAYOUT ──────── */
            searchQuery.trim().length >= 3 && searchType === 'product' ? (
              <div className="space-y-4">
                {filteredByBusinessType.map((restaurant) => (
                  <div
                    key={restaurant.id}
                    className={`overflow-hidden rounded-[24px] border transition-all duration-200 ${
                      restaurant.isOpen
                        ? 'border-black/5 bg-white hover:border-black/10 hover:shadow-[0_12px_40px_rgba(15,15,15,0.06)]'
                        : 'border-black/5 bg-neutral-50 opacity-80'
                    }`}
                  >
                    {/* Compact Restaurant Header */}
                    <div
                      onClick={() => restaurant.isOpen && router.push(`/restaurantes/${restaurant.id}`)}
                      className={`flex items-center gap-3.5 p-4 ${restaurant.isOpen ? 'cursor-pointer' : ''}`}
                    >
                      {/* Restaurant Logo */}
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm relative">
                        {restaurant.logo ? (
                          <Image
                            src={restaurant.logo}
                            alt={restaurant.name}
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        ) : (
                          <span className="text-sm font-bold text-neutral-700">
                            {buildRestaurantInitials(restaurant.name)}
                          </span>
                        )}
                      </div>
                      {/* Restaurant Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-bold text-neutral-900">{restaurant.name}</h3>
                          {!restaurant.isOpen && (
                            <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                              Cerrado
                            </span>
                          )}
                        </div>
                            <div className="mt-0.5 flex items-center gap-2.5 text-xs text-neutral-500">
                              {(() => {
                                const dist = restaurant.calculatedDistance;
                                return dist ? <span>{dist.toFixed(1)} km</span> : null;
                              })()}
                          <span className="flex items-center gap-0.5 font-semibold text-neutral-800">
                            ⭐ {restaurant.rating ? restaurant.rating.toFixed(1) : 'Nuevo'}
                            {(restaurant.reviewCount ?? 0) > 0 && (
                              <span className="font-normal text-neutral-400"> ({restaurant.reviewCount})</span>
                            )}
                          </span>
                          <span className="text-neutral-400">•</span>
                          <span>{formatDeliverySummary(restaurant.effectiveDeliveryFee)}</span>
                        </div>
                      </div>
                      {/* Arrow */}
                      <svg className="h-4 w-4 shrink-0 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>

                    {/* Matching Products List (Horizontal Scroll) */}
                    {restaurant.matchingProducts && restaurant.matchingProducts.length > 0 && (
                      <div className="border-t border-black/5 bg-neutral-50/30">
                        <div className="flex gap-3 overflow-x-auto px-4 py-3.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {restaurant.matchingProducts.map((product: any) => (
                            <div
                              key={product.id}
                              onClick={() => restaurant.isOpen && router.push(`/restaurantes/${restaurant.id}?product=${product.id}`)}
                              className={`w-[240px] sm:w-[260px] shrink-0 flex items-center gap-3 p-2.5 rounded-2xl border border-black/5 bg-white transition-all ${
                                restaurant.isOpen
                                  ? 'cursor-pointer hover:border-black/10 hover:shadow-sm active:scale-[0.99] active-scale'
                                  : 'opacity-60'
                              }`}
                            >
                              {/* Product Image */}
                              {product.image ? (
                                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-black/5">
                                  <Image
                                    src={product.image}
                                    alt={product.name}
                                    fill
                                    sizes="48px"
                                    className="object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-base shrink-0 border border-black/5">
                                  🍔
                                </div>
                              )}
                              {/* Product Info */}
                              <div className="min-w-0 flex-1">
                                <h4 className="truncate text-xs font-bold text-neutral-900">
                                  {highlightText(product.name, searchQuery)}
                                </h4>
                                {product.description && (
                                  <p className="truncate text-[10px] text-neutral-500 mt-0.5">
                                    {highlightText(product.description, searchQuery)}
                                  </p>
                                )}
                              </div>
                              {/* Product Price */}
                              <div className="text-right shrink-0 pl-1.5">
                                {product.discountPrice ? (
                                  <>
                                    <p className="text-xs font-extrabold text-sky-600">${product.discountPrice}</p>
                                    <p className="text-[9px] text-neutral-400 line-through">${product.price}</p>
                                  </>
                                ) : (
                                  <p className="text-xs font-extrabold text-neutral-900">${product.price}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
            /* ──────── RESTAURANT / TIENDA SEARCH LAYOUT (Full Cards) ──────── */
            <div className="space-y-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredByBusinessType.map((restaurant, index) => {
                const primaryCategory = restaurant.storeCategories?.[0];

                return (
                  <React.Fragment key={restaurant.id}>
                  {index === billboardInsertIndex && !billboardAfterGrid && visibleBillboards.length > 0 && (
                    <div className="col-span-full">
                      <BillboardCarousel billboards={visibleBillboards} onNavigate={handleBillboardNavigate} />
                    </div>
                  )}
                  <div
                    className={`group relative overflow-hidden rounded-[30px] border text-left transition-all duration-300 ease-out ${
                      restaurant.isOpen
                        ? 'border-black/5 bg-white hover:-translate-y-1 hover:border-black/10 hover:shadow-[0_24px_60px_rgba(15,15,15,0.08)]'
                        : 'border-black/5 bg-neutral-50 opacity-[0.85] grayscale-[30%]'
                    }`}
                  >
                    {/* Clickable Area for Restaurant/Store */}
                    <div
                      onClick={() => restaurant.isOpen && router.push(`/restaurantes/${restaurant.id}`)}
                      className={restaurant.isOpen ? 'cursor-pointer' : ''}
                    >
                      <div className="relative overflow-hidden h-40 sm:h-44">
                        {restaurant.coverImage ? (
                          <Image
                            src={restaurant.coverImage}
                            alt={`Portada de ${restaurant.name}`}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            className={`object-cover transition duration-300 ${!restaurant.isOpen ? 'grayscale-[80%] brightness-75' : ''}`}
                          />
                        ) : (
                          <div className={`h-40 w-full sm:h-44 transition duration-300 ${buildRestaurantCoverFallback(primaryCategory?.id || 'all')} ${!restaurant.isOpen ? 'grayscale-[80%] brightness-75' : ''}`} />
                        )}

                        {/* OVERLAY FOR CLOSED */}
                        {!restaurant.isOpen && (
                          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/25 backdrop-blur-[2px] pointer-events-none">
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="rounded-full bg-neutral-900/90 px-4 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md">
                                {restaurant.isPaused ? 'Pausado temporalmente' : 'No disponible en este momento'}
                              </div>
                              {restaurant.nextOpenTime && !restaurant.isPaused && (
                                <span className="text-sm font-semibold text-white drop-shadow-md">
                                  Abre {restaurant.nextOpenTime}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Category chip + promotions badge */}
                        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4 z-10 pointer-events-none">
                          <div className="flex flex-col items-start gap-2">
                            {restaurant.isFeatured && (
                              <span className="rounded-full bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-amber-950 shadow-[0_4px_12px_rgba(251,191,36,0.5)] border border-yellow-200/50 flex items-center gap-1.5 backdrop-blur-md">
                                <svg className="w-3.5 h-3.5 fill-amber-950 drop-shadow-sm" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                                Destacado
                              </span>
                            )}
                          </div>
                          {restaurant.hasPromotions && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/85 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 shadow-sm backdrop-blur-md">
                              <svg className="h-3 w-3 fill-rose-500" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                              Promoción
                            </span>
                          )}
                        </div>

                        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
                      </div>

                      <div className="relative px-4 pb-4 pt-4">
                        <div className="mb-2 flex items-end gap-3">
                          <div className="-mt-11 flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-[0_10px_24px_rgba(15,15,15,0.14)] relative">
                            {restaurant.logo ? (
                              <Image
                                src={restaurant.logo}
                                alt={`Logo de ${restaurant.name}`}
                                fill
                                sizes="64px"
                                className="object-cover"
                              />
                            ) : (
                              <span className="text-lg font-semibold text-neutral-900">
                                {buildRestaurantInitials(restaurant.name)}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-xl font-bold tracking-tight">{restaurant.name}</h3>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-neutral-500">{restaurant.address}</p>
                            <div className="mt-1 flex items-center gap-3 text-xs text-neutral-600">
                              {(() => {
                                const dist = restaurant.calculatedDistance;
                                return dist ? <span>{dist.toFixed(1)} km</span> : null;
                              })()}
                              <span className="flex items-center gap-0.5 font-semibold text-neutral-900">
                                ⭐ {restaurant.rating ? restaurant.rating.toFixed(1) : 'Nuevo'}
                                {(restaurant.reviewCount ?? 0) > 0 && (
                                  <span className="font-normal text-neutral-500"> ({restaurant.reviewCount})</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="flex items-center gap-1.5 font-medium text-neutral-700 text-[13px]">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 text-xs">
                              🛵
                            </span>
                            {restaurant.effectiveDeliveryFee === 0 ? 'Envío gratis' : `${formatDeliverySummary(restaurant.effectiveDeliveryFee)} envío`}
                          </span>
                          {(restaurant.description?.toLowerCase().includes('promo') || restaurant.description?.toLowerCase().includes('descuento')) && (
                            <span className="rounded-full bg-[#FEF7E0] px-2.5 py-1 text-xs font-semibold text-[#B06000]">
                              Descuentos disponibles
                            </span>
                          )}
                          <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs text-neutral-500">
                            {formatRegionChipLabel(restaurant.regionName || restaurant.region)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  </React.Fragment>
                );
              })}
            </div>
            {billboardAfterGrid && visibleBillboards.length > 0 && (
              <div className="mt-5">
                <BillboardCarousel billboards={visibleBillboards} onNavigate={handleBillboardNavigate} />
              </div>
            )}
            {hasMoreRestaurants && !isSearching && filteredByBusinessType.length > 0 && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={onLoadMoreRestaurants}
                  disabled={loadingMoreRestaurants}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-6 py-3 text-sm font-bold text-neutral-800 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-500/40 hover:text-sky-600 hover:shadow-[0_8px_24px_rgba(15,15,15,0.06)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                >
                  {loadingMoreRestaurants ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Cargando más…
                    </>
                  ) : (
                    <>Ver más restaurantes</>
                  )}
                </button>
              </div>
            )}
            </div>
          )
          ) : isSearching ? (
            <EmptyState text={
              businessTypeFilter === 'stores'
                ? 'No encontramos tiendas con esa búsqueda. Prueba con otro nombre o zona.'
                : businessTypeFilter === 'all'
                ? 'No encontramos resultados con esa búsqueda. Prueba con otro nombre o zona.'
                : 'No encontramos restaurantes con esa búsqueda. Prueba con otro nombre o zona.'
            } />
          ) : restaurants.length > 0 && filteredByBusinessType.length === 0 ? (
            <EmptyState text={
              businessTypeFilter === 'stores'
                ? 'No hay tiendas que coincidan con los filtros seleccionados.'
                : businessTypeFilter === 'restaurants'
                ? 'No hay restaurantes que coincidan con los filtros seleccionados.'
                : 'No hay resultados que coincidan con los filtros seleccionados. Intenta ajustar los filtros.'
            } />
          ) : activeZones.length > 0 ? (
            <div className="space-y-5">
              <div className="relative overflow-hidden rounded-[32px] border border-black/[0.04] bg-gradient-to-br from-white to-neutral-50/80 px-6 py-10 text-center shadow-[0_2px_20px_rgba(0,0,0,0.03)]">
                <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-sky-400/5 blur-3xl" />
                <div className="absolute -left-12 -bottom-12 h-32 w-32 rounded-full bg-amber-400/5 blur-3xl" />
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-neutral-900 to-neutral-800 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                  <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 16.318A4.486 4.486 0 0 0 12.016 15a4.486 4.486 0 0 0-3.198 1.318M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
                  </svg>
                </div>
                <h3 className="text-[22px] font-black tracking-[-0.04em] text-neutral-900">Aún no hay actividad en tu zona</h3>
                <p className="mt-2 max-w-md mx-auto text-[15px] font-medium leading-relaxed text-neutral-500">
                  Pero puedes explorar las ciudades donde ya estamos presentes y descubrir nuevos lugares:
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  {activeZones.map((zone: any) => (
                    <button
                      key={zone.regionCode}
                      type="button"
                      onClick={() => onZoneSelect?.(zone)}
                      className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-sky-400/70 bg-white/70 px-4 py-2.5 text-sm font-bold text-neutral-800 shadow-[0_2px_12px_rgba(14,165,233,0.15)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-500 hover:shadow-[0_8px_24px_rgba(14,165,233,0.2)] active:scale-[0.97]"
                    >
                      <span className="relative z-10 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                        </svg>
                        {zone.regionName}
                      </span>
                      <span className="relative z-10 inline-flex items-center justify-center rounded-full bg-neutral-900/5 px-2 py-0.5 text-[11px] font-bold text-neutral-500 backdrop-blur-sm">
                        {zone.restaurantCount}
                      </span>
                      <div className="absolute inset-0 bg-gradient-to-r from-white via-sky-50/30 to-white opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[32px] border border-black/[0.04] bg-gradient-to-br from-amber-50/30 to-white px-6 py-7 text-center shadow-[0_2px_20px_rgba(0,0,0,0.03)]">
                <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-amber-400/10 blur-3xl" />
                <h3 className="text-lg font-extrabold tracking-[-0.03em] text-neutral-900">¿Tienes un negocio?</h3>
                <p className="mt-1.5 max-w-sm mx-auto text-sm font-medium text-neutral-500">
                  Lleva tu restaurante o tienda a más clientes. Registrarlo es rápido y sin costo.
                </p>
                <button
                  type="button"
                  onClick={onJoinClick}
                  className="group relative mt-5 inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-neutral-900 px-7 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.97]"
                >
                  <span className="relative z-10">Registrar mi negocio</span>
                  <svg className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                  <div className="absolute inset-0 bg-gradient-to-r from-neutral-800 to-neutral-950 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                </button>
              </div>
            </div>
          ) : (
            <EmptyState text={
              businessTypeFilter === 'stores'
                ? 'No encontramos tiendas con esa búsqueda. Prueba con otro nombre o zona.'
                : businessTypeFilter === 'all'
                ? 'No encontramos resultados con esa búsqueda. Prueba con otro nombre o zona.'
                : 'No encontramos restaurantes con esa búsqueda. Prueba con otro nombre o zona.'
            } />
          )}
        </Panel>
      </div>

      {selectedZoneName && (
        <button
          type="button"
          onClick={onResetZone}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/90 px-5 py-3 text-sm font-semibold text-neutral-600 shadow-lg backdrop-blur-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200/50 hover:text-sky-700 hover:shadow-[0_8px_24px_rgba(14,165,233,0.15)] active:scale-[0.97]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
          Cambiar zona
          <span className="ml-0.5 font-bold text-neutral-800">{selectedZoneName}</span>
        </button>
      )}
    </>
  );
});
