import React, { memo, useEffect, useRef, useState } from 'react';
import { computeDrivingRoute } from '../lib/routes';
import { ensureGoogleMapsScript, getGoogleMaps } from '../lib/googleMaps';
import { buildDriverMapIcon } from '../lib/driver-map-icon';
import { distanceToRouteMeters, isFreshRouteLocation, reserveRouteRequest, type RoutePoint } from '../lib/tracking-route';

type Point = { lat: number; lng: number; updatedAt?: string | null };

type LiveTrackingOrder = {
  id: string;
  status?: string;
  restaurant?: {
    name?: string;
    businessType?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  address?: {
    latitude?: number;
    longitude?: number;
  } | null;
};

// Estilo de mapa claro y desaturado, acorde al look crema de la app
// (similar al tono que usan las apps de delivery).
const MAP_STYLES: unknown[] = [
  { elementType: 'geometry', stylers: [{ color: '#f7f3ea' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8577' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f3ea' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#dcd6c8' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8a8577' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#e7ecdd' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e7e2d4' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fbf3e4' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e2d9c4' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#a89f8a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#a89f8a' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#a89f8a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.line', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d3e0f0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#a3b4c9' }] },
];

const DARK_MAP_STYLES: unknown[] = [
  { elementType: 'geometry', stylers: [{ color: '#202124' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a1a1aa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#202124' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#36373c' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#27272a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#172b3a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

// Marcadores con etiqueta integrada para que no dependan de servicios externos.
function buildPinIcon(google: any, kind: 'store' | 'home', name?: string) {
  const store = kind === 'store';
  const label = (store ? name || 'Negocio' : 'Tu ubicación')
    .slice(0, 20).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] || char);
  const color = store ? '#e51d2a' : '#079dec';
  const icon = store
    ? '<path d="M16 12v8m-3-8v4c0 2 6 2 6 0v-4m-3 8v7m7-15c-2 2-3 5-3 8h3v7m0-15v15" />'
    : '<path d="M11 19l8-7 8 7M13 18v8h12v-8m-8 8v-5h4v5" />';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="62" viewBox="0 0 180 62"><rect x="25" y="9" width="150" height="37" rx="14" fill="#000" opacity=".12"/><rect x="25" y="7" width="150" height="37" rx="14" fill="white"/><path d="M21 2C10 2 2 10 2 21c0 12 19 35 19 35s19-23 19-35C40 10 32 2 21 2Z" fill="${color}" stroke="white" stroke-width="3"/><g fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(2 0)">${icon}</g><text x="46" y="31" fill="${store ? '#c81722' : '#124275'}" font-family="Arial,sans-serif" font-size="${store ? 14 : 12}" font-weight="700">${label}</text></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(144, 50),
    anchor: new google.maps.Point(17, 45),
  };
}

export default memo(function LiveTrackingMap({
  order,
  driverLocation,
}: {
  order: LiveTrackingOrder;
  driverLocation: Point | null;
}) {
  const mapRef = useRef<any>(null);
  const storeMarkerRef = useRef<any>(null);
  const deliveryMarkerRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const glideRafRef = useRef<number | null>(null);
  const initOrderIdRef = useRef<string>('');
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [mapAttempt, setMapAttempt] = useState(0);
  useEffect(() => {
    const applyTheme = () => mapRef.current?.setOptions({
      styles: document.documentElement.classList.contains('dark') ? DARK_MAP_STYLES : MAP_STYLES,
    });
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [mapReady]);
  const [autoFollow, setAutoFollow] = useState(true);
  const autoFollowRef = useRef(true);
  const inTransit = ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'].includes(order.status || '');
  const routeRef = useRef<any>(null);
  const routeState = useRef({ path: [] as RoutePoint[], lastRequest: 0, attempts: 0, pending: false, deviationSince: 0, deviations: 0, lastSample: '' });
  const routeGeneration = useRef(0);
  const [routeLabel, setRouteLabel] = useState('');
  const [routeRetryTick, setRouteRetryTick] = useState(0);
  useEffect(() => {
    if (!inTransit) return;
    const retry = () => setRouteRetryTick(value => value + 1);
    const timer = window.setInterval(retry, 60000);
    window.addEventListener('online', retry);
    return () => { window.clearInterval(timer); window.removeEventListener('online', retry); };
  }, [inTransit]);

  useEffect(() => {
    const generation = ++routeGeneration.current;
    routeRef.current?.setMap(null);
    routeRef.current = null;
    routeState.current = { path: [], lastRequest: 0, attempts: 0, pending: false, deviationSince: 0, deviations: 0, lastSample: '' };
    setRouteLabel('');
    return () => {
      if (routeGeneration.current === generation) routeGeneration.current++;
      routeRef.current?.setMap(null);
      routeRef.current = null;
    };
  }, [order.id, inTransit, order.address?.latitude, order.address?.longitude]);

  useEffect(() => {
    const google = getGoogleMaps();
    const map = mapRef.current;
    const destination = order.address;
    if (!inTransit || !mapReady || !map || !google?.maps) return;
    if (!driverLocation) {
      setRouteLabel('Esperando ubicación del repartidor para calcular la ruta');
      return;
    }
    if (destination?.latitude == null || destination.longitude == null) {
      setRouteLabel('No se puede calcular la ruta: falta el punto de entrega');
      return;
    }
    const timestamp = driverLocation.updatedAt ? Date.parse(driverLocation.updatedAt) : NaN;
    // Sin fecha verificable o con GPS antiguo no se calculan rutas nuevas.
    if (!isFreshRouteLocation(driverLocation, timestamp, Date.now()) || !navigator.onLine) {
      setRouteLabel(!navigator.onLine ? 'Sin conexión · Ruta estimada en pausa' : 'Ruta en pausa · La ubicación del repartidor debe tener menos de 2 minutos');
      return;
    }
    const state = routeState.current;
    const sample = `${timestamp}:${driverLocation.lat}:${driverLocation.lng}`;
    const newSample = sample !== state.lastSample;
    state.lastSample = sample;
    const now = Date.now();
    const distance = distanceToRouteMeters(driverLocation, state.path);
    if (state.path.length && distance <= 100) {
      state.deviationSince = 0;
      state.deviations = 0;
      return;
    }
    if (state.path.length) {
      state.deviationSince ||= now;
      if (newSample) state.deviations++;
      if (state.deviations < 3 || now - state.deviationSince < 20000) return;
    }
    // Una petición por minuto como máximo y 12 intentos por sesión de seguimiento.
    if (state.pending) return;
    const budget = reserveRouteRequest(order.id, now);
    if (budget === 'exhausted') {
      setRouteLabel('Límite de rutas alcanzado · La ubicación sigue actualizándose');
      return;
    }
    if (budget === 'cooldown') return;
    state.pending = true;
    state.lastRequest = now;
    state.attempts++;
    const generation = routeGeneration.current;
    setRouteLabel(state.path.length ? 'Actualizando ruta estimada…' : 'Calculando ruta estimada…');
    void computeDrivingRoute(google, driverLocation, { lat: destination.latitude, lng: destination.longitude }).then((result) => {
      if (generation !== routeGeneration.current || map !== mapRef.current) return;
      const path = result.path;
      if (!path?.length) throw new Error('No route');
      state.path = path.map((p: any) => ({ lat: p.lat(), lng: p.lng() }));
      state.deviationSince = 0;
      state.deviations = 0;
      routeRef.current?.setMap(null);
      routeRef.current = new google.maps.Polyline({ map, path, strokeColor: '#079dec', strokeOpacity: 0.85, strokeWeight: 5, zIndex: 1, clickable: false });
      setRouteLabel('Ruta estimada · Puede variar');
    }).catch(() => {
      if (generation !== routeGeneration.current) return;
      setRouteLabel(state.path.length ? 'Ruta estimada anterior · No se pudo actualizar' : 'Ruta estimada no disponible');
    }).finally(() => { state.pending = false; });
  }, [driverLocation, inTransit, mapReady, order.id, order.address?.latitude, order.address?.longitude, routeRetryTick]);

  const fitTrackingView = (google: any, map: any, driver: Point | null, includeStore: boolean) => {
    const bounds = new google.maps.LatLngBounds();
    if (driver) bounds.extend({ lat: driver.lat, lng: driver.lng });
    if (order.address?.latitude != null && order.address?.longitude != null) {
      bounds.extend({ lat: order.address.latitude, lng: order.address.longitude });
    }
    if (includeStore && order.restaurant?.latitude != null && order.restaurant?.longitude != null) {
      bounds.extend({ lat: order.restaurant.latitude, lng: order.restaurant.longitude });
    }
    if (!bounds.isEmpty()) {
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if (autoFollowRef.current && map.getZoom() > 16) map.setZoom(16);
      });
      map.fitBounds(bounds, { top: 55, bottom: 55, left: 45, right: 130 });
    }
  };

  const clearMapObjects = () => {
    if (glideRafRef.current != null) {
      cancelAnimationFrame(glideRafRef.current);
      glideRafRef.current = null;
    }
    if (storeMarkerRef.current) {
      storeMarkerRef.current.setMap(null);
      storeMarkerRef.current = null;
    }
    if (deliveryMarkerRef.current) {
      deliveryMarkerRef.current.setMap(null);
      deliveryMarkerRef.current = null;
    }
    if (driverMarkerRef.current) {
      driverMarkerRef.current.setMap(null);
      driverMarkerRef.current = null;
    }
    mapRef.current = null;
    initOrderIdRef.current = '';
    setMapReady(false);
  };

  // Limpieza total al desmontar
  useEffect(() => {
    return () => clearMapObjects();
  }, []);

  // Inicialización del mapa: tienda + punto de entrega, zoom encuadrado
  useEffect(() => {
    const orderId = order?.id;
    const storeLat = order?.restaurant?.latitude;
    const storeLng = order?.restaurant?.longitude;
    const destLat = order?.address?.latitude;
    const destLng = order?.address?.longitude;

    if (!orderId || (!storeLat && !destLat)) {
      setMapLoadState('unavailable');
      return;
    }

    let cancelled = false;
    setMapLoadState('loading');
    let loadTimeout: number | undefined;

    const createMap = (google: any) => {
      const mapEl = document.getElementById(`map-tracking-${orderId}`);
      if (!mapEl) throw new Error('Map container unavailable');
      if (initOrderIdRef.current === orderId && mapRef.current) return;

      const map = new google.maps.Map(mapEl, {
        center: { lat: storeLat || destLat, lng: storeLng || destLng },
        zoom: 14,
        styles: MAP_STYLES,
        disableDefaultUI: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_BOTTOM,
        },
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      mapRef.current = map;
      loadTimeout = window.setTimeout(() => {
        if (!cancelled) setMapLoadState('unavailable');
      }, 10000);
      const tilesListener = google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        window.clearTimeout(loadTimeout);
        if (!cancelled) setMapLoadState('ready');
      });
      const pauseFollow = () => {
        autoFollowRef.current = false;
        setAutoFollow(false);
      };
      const dragListener = map.addListener('dragstart', pauseFollow);
      mapEl.addEventListener('wheel', pauseFollow, { passive: true });
      mapEl.addEventListener('touchstart', pauseFollow, { passive: true });
      mapEl.addEventListener('keydown', pauseFollow);
      mapEl.addEventListener('pointerdown', pauseFollow);

      if (storeLat && storeLng) {
        storeMarkerRef.current = new google.maps.Marker({
          position: { lat: storeLat, lng: storeLng },
          map: inTransit ? null : map,
          icon: buildPinIcon(google, 'store', order?.restaurant?.name),
          zIndex: 2,
          title: order?.restaurant?.name || 'Tienda',
        });
      }

      if (destLat && destLng) {
        deliveryMarkerRef.current = new google.maps.Marker({
          position: { lat: destLat, lng: destLng },
          map,
          icon: buildPinIcon(google, 'home'),
          zIndex: 2,
          title: 'Punto de entrega',
        });
      }

      fitTrackingView(google, map, driverLocation, !inTransit);

      // Forzar resize para evitar mapa recortado/gris tras la expansión del banner
      const resizeTimer = window.setTimeout(() => {
        if (mapRef.current) {
          google.maps.event.trigger(mapRef.current, 'resize');
        }
      }, 250);

      initOrderIdRef.current = orderId;
      setMapReady(true);
      return () => {
        window.clearTimeout(resizeTimer);
        tilesListener.remove();
        dragListener.remove();
        mapEl.removeEventListener('wheel', pauseFollow);
        mapEl.removeEventListener('touchstart', pauseFollow);
        mapEl.removeEventListener('keydown', pauseFollow);
        mapEl.removeEventListener('pointerdown', pauseFollow);
      };
    };

    clearMapObjects();
    autoFollowRef.current = true;
    setAutoFollow(true);
    let removeInteractions: (() => void) | undefined;
    void ensureGoogleMapsScript().then((google) => {
      if (cancelled) return;
      if (google) removeInteractions = createMap(google);
      else throw new Error('Map unavailable');
    }).catch(() => {
      window.clearTimeout(loadTimeout);
      if (!cancelled) setMapLoadState('unavailable');
    });

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimeout);
      removeInteractions?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, mapAttempt, order.restaurant?.latitude, order.restaurant?.longitude, order.address?.latitude, order.address?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    const google = getGoogleMaps();
    if (!mapReady || !map || !google?.maps) return;
    storeMarkerRef.current?.setMap(inTransit ? null : map);
    if (autoFollowRef.current) fitTrackingView(google, map, driverLocation, !inTransit);
    // Reencuadrar al cambiar de etapa, sin reiniciar el mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTransit, mapReady]);

  // Reajustar al cambiar tamaño de la ventana
  useEffect(() => {
    const handleResize = () => {
      const google = getGoogleMaps();
      if (google?.maps && mapRef.current) {
        google.maps.event.trigger(mapRef.current, 'resize');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Marcador del repartidor con movimiento suave, sin dibujar una ruta.
  useEffect(() => {
    const google = getGoogleMaps();
    const map = mapRef.current;

    if (!google?.maps || !mapReady || !map || !driverLocation || !order) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setMap(null);
        driverMarkerRef.current = null;
      }
      return;
    }

    const { lat, lng } = driverLocation;

    // Primer punto: crear marcador y encuadrar los puntos relevantes.
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map,
        icon: buildDriverMapIcon(google),
        title: 'Ubicación del repartidor',
        zIndex: 3,
      });

      if (autoFollowRef.current) fitTrackingView(google, map, driverLocation, !inTransit);
      return;
    }

    // Glide suave del marcador
    if (glideRafRef.current != null) {
      cancelAnimationFrame(glideRafRef.current);
      glideRafRef.current = null;
    }

    const markerPos = driverMarkerRef.current.getPosition();
    const startLat = markerPos.lat();
    const startLng = markerPos.lng();
    const endLat = lat;
    const endLng = lng;

    const duration = 1600;
    let startTime: number | null = null;

    const animateMarker = (timestamp: number) => {
      if (startTime == null) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentLat = startLat + (endLat - startLat) * eased;
      const currentLng = startLng + (endLng - startLng) * eased;

      if (driverMarkerRef.current) {
        driverMarkerRef.current.setPosition({ lat: currentLat, lng: currentLng });
      }

      if (progress < 1) {
        glideRafRef.current = requestAnimationFrame(animateMarker);
      } else {
        glideRafRef.current = null;
        if (autoFollowRef.current && mapRef.current) {
          fitTrackingView(google, mapRef.current, { lat: endLat, lng: endLng }, !inTransit);
        }
      }
    };

    glideRafRef.current = requestAnimationFrame(animateMarker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocation, order?.id, inTransit, mapReady]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const updatedAt = driverLocation?.updatedAt ? Date.parse(driverLocation.updatedAt) : NaN;
  const ageMinutes = Number.isFinite(updatedAt) ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : null;

  return (
    <div className="relative">
      <div
        key={`${order.id}:${mapAttempt}`}
        id={`map-tracking-${order?.id}`}
        inert={mapLoadState !== 'ready' ? true : undefined}
        aria-hidden={mapLoadState !== 'ready' ? true : undefined}
        className={`h-60 w-full rounded-2xl border border-black/[0.05] bg-neutral-100 z-0 no-invert md:h-72 ${mapLoadState !== 'ready' ? 'opacity-0' : ''}`}
      />
      {mapLoadState !== 'ready' && (
        <div className="absolute inset-x-0 top-0 flex h-60 flex-col items-center justify-center gap-2 rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 to-white px-4 text-center dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-800 md:h-72">
          <div role="status" className="flex flex-col items-center gap-2">
            <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-950/60">
              {mapLoadState === 'loading' ? <span className="h-5 w-5 rounded-full border-2 border-red-300 border-t-red-700 motion-safe:animate-spin dark:border-red-900 dark:border-t-red-400" /> : <span className="font-bold text-red-700 dark:text-red-300">!</span>}
            </span>
            <p className="text-sm font-bold text-neutral-950 dark:text-zinc-100">{mapLoadState === 'loading' ? 'Cargando mapa…' : 'El mapa no está disponible'}</p>
            <p className="text-xs text-neutral-600 dark:text-zinc-400">{mapLoadState === 'loading' ? 'Preparando la vista de tu entrega.' : 'Puedes seguir consultando el estado de tu pedido.'}</p>
          </div>
          {mapLoadState === 'unavailable' && <button type="button" onClick={() => { setMapLoadState('loading'); setMapAttempt(value => value + 1); }} className="mt-1 min-h-11 rounded-full bg-red-700 px-4 text-xs font-bold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">Reintentar</button>}
        </div>
      )}
      {inTransit && routeLabel && <p role="status" className="mt-2 px-1 text-[11px] text-neutral-500">{routeLabel}</p>}
      {!autoFollow && mapLoadState === 'ready' && (
        <button type="button" onClick={() => {
          const google = getGoogleMaps();
          if (!google?.maps || !mapRef.current) return;
          autoFollowRef.current = true;
          setAutoFollow(true);
          fitTrackingView(google, mapRef.current, driverLocation, !inTransit);
        }} className="absolute right-3 top-3 z-[5] rounded-full bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-bold text-neutral-800 dark:text-zinc-100 shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
          Centrar mapa
        </button>
      )}
      {driverLocation && (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-xl bg-neutral-50 dark:bg-zinc-800 px-3 py-2.5 text-[11px] font-medium text-neutral-600 dark:text-zinc-300">
          <span className={`h-2 w-2 shrink-0 rounded-full ${ageMinutes !== null && ageMinutes < 2 ? 'bg-emerald-500 motion-safe:animate-pulse' : 'bg-amber-500'}`} />
          {ageMinutes === null ? 'Hora de ubicación no disponible' : ageMinutes < 1 ? 'Ubicación actualizada hace menos de 1 minuto' : `Última ubicación: hace ${ageMinutes} min`}
          {ageMinutes !== null && ageMinutes >= 2 && ' · Puede estar desactualizada'}
        </div>
      )}
    </div>
  );
});
