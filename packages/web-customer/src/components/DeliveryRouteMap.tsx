'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { useEffect, useRef, useState } from 'react';
import { ensureGoogleMapsScript, getGoogleMaps } from '../lib/googleMaps';

export type MapPoint = {
  lat: number;
  lng: number;
  label: string;
  emoji?: string;
  color?: string;
};

type Props = {
  origin: MapPoint | null;
  destination: MapPoint;
  userPos?: { lat: number; lng: number } | null;
  height?: number;
};

const MAP_STYLES: unknown[] = [
  { elementType: 'geometry', stylers: [{ color: '#f7f3ea' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8577' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f3ea' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#dcd6c8' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#a89f8a' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#a89f8a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d3e0f0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#a3b4c9' }] },
];

function buildPinIcon(google: any, emoji: string, bg: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 1C11.7 1 5 7.7 5 16c0 9 15 31 15 31s15-22 15-31C35 7.7 28.3 1 20 1Z" fill="${bg}" stroke="#ffffff" stroke-width="2"/><circle cx="20" cy="15.5" r="10.5" fill="#ffffff"/><text x="20" y="19.5" font-size="12" text-anchor="middle">${emoji}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: new google.maps.Size(40, 48),
    anchor: new google.maps.Point(20, 44),
  };
}

export default function DeliveryRouteMap({ origin, destination, userPos, height = 200 }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const [google, setGoogle] = useState<any>(null);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    const existing = getGoogleMaps();
    if (existing) {
      setGoogle(existing);
      return;
    }
    let cancelled = false;
    void ensureGoogleMapsScript().then((g) => {
      if (cancelled) return;
      setGoogle(g);
      setMapError(!g);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!google || !mapRef.current) return;
    const container = mapRef.current;

    const map = new google.maps.Map(container, {
      center: { lat: destination.lat, lng: destination.lng },
      zoom: 15,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      styles: MAP_STYLES,
    });
    mapInstanceRef.current = map;

    const markers: any[] = [];
    const addMarker = (point: MapPoint) => {
      markers.push(
        new google.maps.Marker({
          position: { lat: point.lat, lng: point.lng },
          map,
          icon: buildPinIcon(google, point.emoji || '📍', point.color || '#ef4444'),
          title: point.label,
        })
      );
    };

    const bounds = new google.maps.LatLngBounds();
    if (origin) {
      addMarker(origin);
      bounds.extend({ lat: origin.lat, lng: origin.lng });
    }
    addMarker(destination);
    bounds.extend({ lat: destination.lat, lng: destination.lng });

    let directionsRenderer: any = null;
    if (origin) {
      const directionsService = new google.maps.DirectionsService();
      directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#0ea5e9', strokeWeight: 5, strokeOpacity: 0.9 },
      });
      directionsService.route(
        {
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result: any, status: string) => {
          if (status === google.maps.DirectionsStatus.OK && result && directionsRenderer) {
            directionsRenderer.setDirections(result);
          } else {
            map.fitBounds(bounds);
          }
        }
      );
    }

    let userMarker: any = null;
    if (userPos) {
      userMarker = new google.maps.Marker({
        position: { lat: userPos.lat, lng: userPos.lng },
        map,
        icon: buildPinIcon(google, '🛵', '#0ea5e9'),
        title: 'Tu posición',
      });
      userMarkerRef.current = userMarker;
      bounds.extend({ lat: userPos.lat, lng: userPos.lng });
    }

    if (!origin) {
      map.setCenter({ lat: destination.lat, lng: destination.lng });
      map.setZoom(16);
    } else {
      map.fitBounds(bounds);
    }

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
      markers.forEach((m) => m.setMap(null));
      if (directionsRenderer) directionsRenderer.setMap(null);
      mapInstanceRef.current = null;
      if (container) container.innerHTML = '';
    };
    // El mapa solo se crea cuando cambian el origen/destino estáticos o el
    // script de Google Maps. La posición GPS NO está en las dependencias:
    // mover el marcador por ref evita re-descargar los tiles del mapa en cada
    // fix (ahorro de datos móviles real).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google, origin?.lat, origin?.lng, destination.lat, destination.lng]);

  // Ahorro de datos: la posición llega cada ~8 s; en lugar de re-montar el
  // mapa (tiles descargados de nuevo), solo movemos el marcador del
  // repartidor. El marcador se crea aquí si llega la primera posición después
  // de crearse el mapa (caso típico: el GPS tarda unos segundos).
  useEffect(() => {
    if (!google || !userPos) return;
    if (!userMarkerRef.current) {
      if (!mapInstanceRef.current) return;
      userMarkerRef.current = new google.maps.Marker({
        position: { lat: userPos.lat, lng: userPos.lng },
        map: mapInstanceRef.current,
        icon: buildPinIcon(google, '🛵', '#0ea5e9'),
        title: 'Tu posición',
      });
    } else {
      userMarkerRef.current.setPosition({ lat: userPos.lat, lng: userPos.lng });
    }
  }, [google, userPos]);

  return mapError ? (
    <div
      style={{ width: '100%', height }}
      className="flex flex-col items-center justify-center rounded-[20px] bg-neutral-100 px-6 text-center dark:bg-zinc-900"
    >
      <span className="text-xl">🗺️</span>
      <p className="mt-2 text-xs font-bold text-neutral-600 dark:text-zinc-300">No se pudo cargar el mapa</p>
      <p className="mt-1 text-[10px] text-neutral-500 dark:text-zinc-500">
        Verifica tu conexión; la navegación por voz sigue disponible.
      </p>
    </div>
  ) : (
    <div ref={mapRef} style={{ width: '100%', height }} className="rounded-[20px]" />
  );
}
