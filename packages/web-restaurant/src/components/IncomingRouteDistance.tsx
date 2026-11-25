'use client';

import { ChevronDown, House, Route as RouteIcon, Store } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ensureGoogleMapsScript } from '../lib/googleMaps';
import { fetchIncomingRoute } from '../lib/incomingRoute';

type Props = {
  originLatitude?: number | null;
  originLongitude?: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
};

type Point = { lat: number; lng: number };
type RouteResult = { distanceMeters: number; path: Point[] };
type Preview = { google: any; origin: Point; destination: Point; route: RouteResult | null };

function markerIcon(google: any, kind: 'store' | 'home') {
  const shape = kind === 'store'
    ? '<path d="M8 12v6h8v-6M7 12h10l-1-4H8zM10 18v-3h4v3"/>'
    : '<path d="m7 12 5-4 5 4M8.5 11v7h7v-7M11 18v-3h2v3"/>';
  const color = kind === 'store' ? '#171717' : '#b91c1c';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path fill="${color}" stroke="white" stroke-width="2" d="M20 1C9.5 1 2 8.4 2 18.3 2 30 20 46 20 46s18-16 18-27.7C38 8.4 30.5 1 20 1Z"/><g transform="translate(5 3) scale(1.25)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(36, 43), anchor: new google.maps.Point(18, 43) };
}

function toPoint(lat?: number | null, lng?: number | null): Point | null {
  return typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng } : null;
}

function RouteMap({ preview }: { preview: Preview }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const { google, origin, destination, route } = preview;
    const overlays: Array<{ setMap: (map: null) => void }> = [];
    let idleListener: { remove: () => void } | undefined;
    try {
      const map = new google.maps.Map(element, {
        center: destination, zoom: 15, disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false,
        clickableIcons: false, backgroundColor: '#f5f5f5',
      });
      if (route) overlays.push(new google.maps.Polyline({ map, path: route.path, strokeColor: '#b91c1c', strokeWeight: 4 }));
      overlays.push(new google.maps.Marker({ map, position: origin, icon: markerIcon(google, 'store'), title: 'Restaurante' }));
      overlays.push(new google.maps.Marker({ map, position: destination, icon: markerIcon(google, 'home'), title: 'Domicilio de entrega' }));
      if (origin.lat !== destination.lat || origin.lng !== destination.lng) {
        const bounds = new google.maps.LatLngBounds();
        for (const point of [origin, destination, ...(route?.path ?? [])]) bounds.extend(point);
        map.fitBounds(bounds, 24);
        idleListener = google.maps.event.addListenerOnce(map, 'idle', () => {
          if (map.getZoom() > 17) map.setZoom(17);
        });
      }
    } catch {
      setFailed(true);
    }
    return () => {
      idleListener?.remove();
      overlays.forEach((overlay) => overlay.setMap(null));
      element.replaceChildren();
    };
  }, [preview]);

  return failed ? <p className="text-xs text-neutral-600">No se pudo mostrar el mapa.</p> : (
    <>
      <div ref={container} className="h-36 w-full overflow-hidden rounded-lg bg-neutral-100 sm:h-44" role="region" aria-label="Mapa del restaurante y punto de entrega" />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-neutral-600">
        <span className="inline-flex items-center gap-1"><Store aria-hidden="true" className="h-3.5 w-3.5 text-neutral-900" />Restaurante</span>
        <span className="inline-flex items-center gap-1"><House aria-hidden="true" className="h-3.5 w-3.5 text-red-700" />Domicilio</span>
        {!preview.route && <span>Sin ruta disponible</span>}
      </div>
    </>
  );
}

export function IncomingRouteDistance({ originLatitude, originLongitude, destinationLatitude, destinationLongitude }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [mapVisibility, setMapVisibility] = useState<'unopened' | 'open' | 'collapsed'>('unopened');
  const expanded = mapVisibility === 'open';
  const mapId = useId();

  useEffect(() => {
    let cancelled = false;
    const origin = toPoint(originLatitude, originLongitude);
    const destination = toPoint(destinationLatitude, destinationLongitude);
    setPreview(null);
    setError('');
    setMapVisibility('unopened');
    if (!origin || !destination) {
      setError('Faltan coordenadas válidas del restaurante o de la entrega.');
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setError('La consulta de Google Maps tardó demasiado. Comprueba la conexión e intenta de nuevo.');
    }, 18000);
    void (async () => {
      try {
        const google = await ensureGoogleMapsScript();
        if (cancelled) return;
        if (!google) throw new Error('No se pudo cargar Google Maps. Comprueba la conexión o la configuración de Maps.');
        setPreview({ google, origin, destination, route: null });
        const route = await fetchIncomingRoute(google, origin, destination);
        if (cancelled) return;
        setError('');
        setPreview({ google, origin, destination, route });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo calcular la ruta.');
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [originLatitude, originLongitude, destinationLatitude, destinationLongitude, attempt]);

  const distance = preview?.route?.distanceMeters;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p role="status" className="flex items-center gap-1 text-xs font-semibold text-neutral-600">
          <RouteIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {loading ? 'Calculando ruta…' : distance == null ? 'Distancia por ruta no disponible' : `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(distance / 1000)} km por ruta`}
        </p>
        {preview && (
          <button type="button" aria-expanded={expanded} aria-controls={mapId} onClick={() => setMapVisibility(expanded ? 'collapsed' : 'open')} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700">
            {expanded ? 'Ocultar mapa' : 'Ver mapa'}<ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
        {!loading && distance == null && toPoint(originLatitude, originLongitude) && toPoint(destinationLatitude, destinationLongitude) && (
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700">Reintentar ruta</button>
        )}
      </div>
      {error && <p className="text-xs text-neutral-600" role="status">{error}</p>}
      <div id={mapId} hidden={!expanded}>
        {mapVisibility !== 'unopened' && preview && <RouteMap preview={preview} />}
      </div>
    </div>
  );
}
