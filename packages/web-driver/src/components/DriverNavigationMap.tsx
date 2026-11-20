'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { ensureGoogleMapsScript, getGoogleMaps } from '../lib/googleMaps';

type Point = { lat: number; lng: number };

type Destination = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  emoji: string;
};

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

function buildPinIcon(google: any, bg: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 1C11.7 1 5 7.7 5 16c0 9 15 31 15 31s15-22 15-31C35 7.7 28.3 1 20 1Z" fill="${bg}" stroke="#ffffff" stroke-width="2"/><circle cx="20" cy="15.5" r="10.5" fill="#ffffff"/><circle cx="20" cy="15.5" r="5" fill="${bg}"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(36, 43),
    anchor: new google.maps.Point(18, 42),
  };
}

function buildDriverIcon(google: any) {
  return {
    url:
      'data:image/svg+xml;charset=UTF-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="#0ea5e9" stroke="#ffffff" stroke-width="3"/></svg>'
      ),
    scaledSize: new google.maps.Size(36, 36),
    anchor: new google.maps.Point(18, 18),
  };
}

function haversineMeters(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Solo re-calculamos la ruta si el repartidor se alejó demasiado del origen (evita gastar Directions).
const ROUTE_RECALC_DISTANCE_M = 800;

export default memo(function DriverNavigationMap({
  origin,
  destination,
  heightClass = 'h-64',
}: {
  origin: Point | null;
  destination: Destination | null;
  heightClass?: string;
}) {
  const mapElIdRef = useRef<string>(`drv-nav-${Math.random().toString(36).slice(2)}`);
  const mapRef = useRef<any>(null);
  const originMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const playgroundRef = useRef<any>(null);
  const originRef = useRef<Point | null>(origin);
  const destinationRef = useRef<Destination | null>(destination);
  const lastRouteOriginRef = useRef<Point | null>(null);
  const lastRouteDestinationIdRef = useRef<string>('');
  const pendingRouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeInFlightRef = useRef(false);
  const routeQueuedRef = useRef(false);
  const requestRouteRef = useRef<() => void>(() => {});
  const [mapReady, setMapReady] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distanceM: number; durationMin: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState<Point | null>(origin);

  originRef.current = origin;
  destinationRef.current = destination;

  const clearMapObjects = () => {
    if (pendingRouteTimerRef.current != null) {
      clearTimeout(pendingRouteTimerRef.current);
      pendingRouteTimerRef.current = null;
    }
    if (originMarkerRef.current) {
      originMarkerRef.current.setMap(null);
      originMarkerRef.current = null;
    }
    if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }
    if (routeRef.current) {
      routeRef.current.setMap(null);
      routeRef.current = null;
    }
    if (playgroundRef.current) {
      playgroundRef.current.setMap(null);
      playgroundRef.current = null;
    }
    mapRef.current = null;
  };

  useEffect(() => {
    return () => clearMapObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar la API de Maps de forma perezosa.
  useEffect(() => {
    let cancelled = false;
    ensureGoogleMapsScript()
      .then((g) => {
        if (!cancelled) {
          if (g) setMapReady(true);
          else setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Pedir la posición actual al abrir el mapa (si no vino como prop).
  useEffect(() => {
    if (currentOrigin || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentOrigin({
          lat: parseFloat(pos.coords.latitude.toFixed(6)),
          lng: parseFloat(pos.coords.longitude.toFixed(6)),
        });
      },
      () => setGpsError(true),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inicializar el mapa cuando la API esté lista.
  useEffect(() => {
    if (!mapReady) return;

    let cancelled = false;

    const createMap = (google: any) => {
      const mapEl = document.getElementById(mapElIdRef.current);
      if (!mapEl || mapRef.current) return;

      const fallbackLat = destinationRef.current?.lat || 19.4326;
      const fallbackLng = destinationRef.current?.lng || -99.1332;

      const map = new google.maps.Map(mapEl, {
        center: { lat: fallbackLat, lng: fallbackLng },
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

      setTimeout(() => {
        if (mapRef.current) google.maps.event.trigger(mapRef.current, 'resize');
      }, 250);

      requestRoute();
    };

    void ensureGoogleMapsScript().then((google) => {
      if (cancelled || !google) return;
      createMap(google);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  const requestRoute = () => {
    const google = getGoogleMaps();
    const map = mapRef.current;
    const dest = destinationRef.current;
    const originPoint = originRef.current || currentOrigin;

    if (!google?.maps || !map || !dest || !originPoint) return;

    // Cache de ruta: solo recalcular si cambia el destino o nos alejamos del origen previo.
    const sameDest = lastRouteDestinationIdRef.current === dest.id;
    const lastOrigin = lastRouteOriginRef.current;
    const movedFromOrigin =
      !lastOrigin || haversineMeters(lastOrigin, originPoint) >= ROUTE_RECALC_DISTANCE_M;

    if (sameDest && !movedFromOrigin && routeRef.current) {
      fitRouteBounds();
      return;
    }

    if (routeInFlightRef.current) {
      routeQueuedRef.current = true;
      return;
    }

    routeInFlightRef.current = true;
    const directions = new google.maps.DirectionsService();

    directions.route(
      {
        origin: { lat: originPoint.lat, lng: originPoint.lng },
        destination: { lat: dest.lat, lng: dest.lng },
        travelMode: google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false,
      },
      (result: any, status: string) => {
        routeInFlightRef.current = false;
        if (status === 'OK' && result) {
          lastRouteOriginRef.current = originPoint;
          lastRouteDestinationIdRef.current = dest.id;

          if (routeRef.current) {
            routeRef.current.setMap(null);
            routeRef.current = null;
          }
          routeRef.current = new google.maps.DirectionsRenderer({
            map,
            directions: result,
            suppressMarkers: true,
            polylineOptions: {
              strokeColor: '#0ea5e9',
              strokeOpacity: 0.9,
              strokeWeight: 6,
            },
            preserveViewport: true,
          });

          const leg = result.routes?.[0]?.legs?.[0];
          if (leg?.distance?.value != null && leg?.duration?.value != null) {
            setRouteInfo({
              distanceM: leg.distance.value,
              durationMin: Math.round(leg.duration.value / 60),
            });
          }

          // Pin del repartidor (origen)
          if (!originMarkerRef.current) {
            originMarkerRef.current = new google.maps.Marker({
              position: { lat: originPoint.lat, lng: originPoint.lng },
              map,
              icon: buildDriverIcon(google),
              zIndex: 3,
            });
          } else {
            originMarkerRef.current.setPosition({ lat: originPoint.lat, lng: originPoint.lng });
          }

          // Pin del destino
          if (!destMarkerRef.current) {
            destMarkerRef.current = new google.maps.Marker({
              position: { lat: dest.lat, lng: dest.lng },
              map,
              icon: buildPinIcon(google, '#0f172a'),
              zIndex: 2,
              title: dest.label,
            });
          }

          fitRouteBounds();
        }
        if (routeQueuedRef.current) {
          routeQueuedRef.current = false;
          requestRouteRef.current();
        }
      }
    );
  };
  requestRouteRef.current = requestRoute;

  const fitRouteBounds = () => {
    const google = getGoogleMaps();
    const map = mapRef.current;
    const originPoint = originRef.current || currentOrigin;
    const dest = destinationRef.current;
    if (!google?.maps || !map) return;

    const bounds = new google.maps.LatLngBounds();
    if (originPoint) bounds.extend({ lat: originPoint.lat, lng: originPoint.lng });
    if (dest) bounds.extend({ lat: dest.lat, lng: dest.lng });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 70);
      if (map.getZoom() > 16) map.setZoom(16);
    }
  };

  // Recalcular la ruta y mover el pin del repartidor cuando cambia el origen.
  useEffect(() => {
    const originPoint = originRef.current || currentOrigin;
    if (!originPoint || !mapReady) return;

    if (currentOrigin) {
      setCurrentOrigin(originPoint);
    }

    if (pendingRouteTimerRef.current != null) {
      clearTimeout(pendingRouteTimerRef.current);
    }
    pendingRouteTimerRef.current = setTimeout(() => {
      pendingRouteTimerRef.current = null;
      const google = getGoogleMaps();
      if (google?.maps && originMarkerRef.current) {
        originMarkerRef.current.setPosition({ lat: originPoint.lat, lng: originPoint.lng });
      }
      requestRoute();
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrigin, origin?.lat, origin?.lng]);

  // Recalcular la ruta si cambia el destino (fase de recogida → entrega).
  useEffect(() => {
    const dest = destinationRef.current;
    if (!dest || !mapReady) return;
    if (pendingRouteTimerRef.current != null) {
      clearTimeout(pendingRouteTimerRef.current);
    }
    pendingRouteTimerRef.current = setTimeout(() => {
      pendingRouteTimerRef.current = null;
      requestRoute();
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.id]);

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

  if (loadError) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-border dark:border-zinc-800 bg-surface-2 dark:bg-zinc-900/60 text-xs font-semibold text-muted dark:text-zinc-400 p-4 text-center">
        No se pudo cargar el mapa. Usa{' '}
        <span className="font-bold text-sky-600 dark:text-sky-400">Abrir en Google Maps</span> para
        navegar.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        id={mapElIdRef.current}
        className={`w-full rounded-2xl border border-black/[0.05] bg-surface-2 z-0 ${heightClass}`}
      />

      {gpsError && origin === null && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold px-1">
          No pudimos obtener tu ubicación automáticamente. Mueve la vista al área de recogida o
          destino.
        </p>
      )}

      {routeInfo && (
        <div className="flex items-center justify-between rounded-xl bg-sky-50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/30 px-3 py-2 text-xs font-bold text-sky-700 dark:text-sky-300">
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM6.5 20l.5-5 2 1.5 1.5-4.5 1.5 4.5L14 15l.5 5" />
            </svg>
            ~{Math.round(routeInfo.distanceM / 100) / 10} km
          </span>
          <span className="flex items-center gap-1.5">⏱ ~{routeInfo.durationMin} min</span>
        </div>
      )}
    </div>
  );
});
