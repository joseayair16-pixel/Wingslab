import React, { memo, useEffect, useRef, useState } from 'react';
import { getOrderStatusLabel } from '@sadel/shared';
import { ensureGoogleMapsScript, getGoogleMaps } from '../lib/googleMaps';

type Point = { lat: number; lng: number };

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

// Distancia mínima (metros) entre puntos GPS para agregar al rastro.
// Por debajo de esto el repartidor envía ubicaciones redundantes.
const MIN_TRAIL_DISTANCE_M = 25;

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

// Genera un pin tipo "teardrop" con emoji y anillo blanco.
function buildPinIcon(google: any, emoji: string, bg: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 1C11.7 1 5 7.7 5 16c0 9 15 31 15 31s15-22 15-31C35 7.7 28.3 1 20 1Z" fill="${bg}" stroke="#ffffff" stroke-width="2"/><circle cx="20" cy="15.5" r="10.5" fill="#ffffff"/><text x="20" y="19.5" font-size="12" text-anchor="middle">${emoji}</text></svg>`;
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
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="28" filter="drop-shadow(0px 2px 6px rgba(0,0,0,0.4))">🛵</text></svg>'
      ),
    scaledSize: new google.maps.Size(36, 36),
    anchor: new google.maps.Point(18, 18),
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
  const polylineRef = useRef<any>(null);
  const trailPointsRef = useRef<Point[]>([]);
  const glideRafRef = useRef<number | null>(null);
  const initOrderIdRef = useRef<string>('');
  const [mapReady, setMapReady] = useState(false);

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
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    trailPointsRef.current = [];
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

    if (!orderId || (!storeLat && !destLat)) return;

    let cancelled = false;

    const createMap = (google: any) => {
      const mapEl = document.getElementById(`map-tracking-${orderId}`);
      if (!mapEl) return;
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

      if (storeLat && storeLng) {
        storeMarkerRef.current = new google.maps.Marker({
          position: { lat: storeLat, lng: storeLng },
          map,
          icon: buildPinIcon(google, '🏪', '#0f172a'),
          zIndex: 2,
          title: order?.restaurant?.name || 'Tienda',
        });
      }

      if (destLat && destLng) {
        deliveryMarkerRef.current = new google.maps.Marker({
          position: { lat: destLat, lng: destLng },
          map,
          icon: buildPinIcon(google, '🏠', '#0ea5e9'),
          zIndex: 2,
          title: 'Punto de entrega',
        });
      }

      // Encuadrar tienda + entrega si ambos existen
      const bounds = new google.maps.LatLngBounds();
      if (storeLat && storeLng) bounds.extend({ lat: storeLat, lng: storeLng });
      if (destLat && destLng) bounds.extend({ lat: destLat, lng: destLng });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 60);
        if (map.getZoom() > 16) map.setZoom(16);
      }

      // Forzar resize para evitar mapa recortado/gris tras la expansión del banner
      setTimeout(() => {
        if (mapRef.current) {
          google.maps.event.trigger(mapRef.current, 'resize');
        }
      }, 250);

      initOrderIdRef.current = orderId;
      setMapReady(true);
    };

    clearMapObjects();
    void ensureGoogleMapsScript().then((google) => {
      if (cancelled || !google) return;
      createMap(google);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

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

  // Marcador del repartidor + rastro real (polyline) con glide suave
  useEffect(() => {
    const google = getGoogleMaps();
    const map = mapRef.current;

    if (!google?.maps || !mapReady || !map || !driverLocation || !order) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setMap(null);
        driverMarkerRef.current = null;
      }
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
      trailPointsRef.current = [];
      return;
    }

    const { lat, lng } = driverLocation;

    // Primer punto: crear marcador + rastro + encuadre completo
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map,
        icon: buildDriverIcon(google),
        zIndex: 3,
      });

      trailPointsRef.current = [{ lat, lng }];
      polylineRef.current = new google.maps.Polyline({
        path: [{ lat, lng }],
        map,
        strokeColor: '#0284c7',
        strokeOpacity: 0.85,
        strokeWeight: 5,
        zIndex: 1,
        geodesic: true,
      });

      const sLat = order.restaurant?.latitude;
      const sLng = order.restaurant?.longitude;
      const dLat = order.address?.latitude;
      const dLng = order.address?.longitude;

      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat, lng });
      if (sLat && sLng) bounds.extend({ lat: sLat, lng: sLng });
      if (dLat && dLng) bounds.extend({ lat: dLat, lng: dLng });
      map.fitBounds(bounds, 60);
      if (map.getZoom() > 16) map.setZoom(16);
      return;
    }

    // Agregar punto al rastro solo si hubo movimiento real
    const lastPoint = trailPointsRef.current[trailPointsRef.current.length - 1];
    if (!lastPoint || haversineMeters(lastPoint, { lat, lng }) >= MIN_TRAIL_DISTANCE_M) {
      trailPointsRef.current.push({ lat, lng });
      if (polylineRef.current) {
        polylineRef.current.setPath(trailPointsRef.current);
      }
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
        // Mantener en cámara repartidor + entrega
        const dLat = order.address?.latitude;
        const dLng = order.address?.longitude;
        if (dLat && dLng && mapRef.current) {
          const b = new google.maps.LatLngBounds();
          b.extend({ lat: endLat, lng: endLng });
          b.extend({ lat: dLat, lng: dLng });
          mapRef.current.fitBounds(b, { top: 70, bottom: 70, left: 60, right: 60 });
          if (mapRef.current.getZoom() > 16) mapRef.current.setZoom(16);
        } else if (mapRef.current) {
          mapRef.current.panTo({ lat: endLat, lng: endLng });
        }
      }
    };

    glideRafRef.current = requestAnimationFrame(animateMarker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocation, order?.id, mapReady]);

  const statusLabel =
    order?.status === 'DRIVER_ARRIVED'
      ? 'Tu repartidor está llegando'
      : order?.status
        ? getOrderStatusLabel(order.status, order.restaurant?.businessType)
        : null;

  return (
    <div className="relative">
      <div
        id={`map-tracking-${order?.id}`}
        className="h-52 w-full rounded-2xl border border-black/[0.05] bg-neutral-50 z-0 animate-scale-up no-invert md:h-64"
      />
      {statusLabel && (
        <div className="absolute left-2.5 top-2.5 z-[5] flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur pointer-events-none dark:border-white/10 dark:bg-zinc-900/85">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] font-bold text-neutral-900 dark:text-zinc-100">
            {statusLabel}
          </span>
        </div>
      )}
    </div>
  );
});