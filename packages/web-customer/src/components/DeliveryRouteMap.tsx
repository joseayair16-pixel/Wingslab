'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { useEffect, useRef, useState } from 'react';

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

function waitForGoogle(resolve: () => void, attempts = 0) {
  if ((window as any).google?.maps) {
    resolve();
    return;
  }
  if (attempts > 40) return;
  setTimeout(() => waitForGoogle(resolve, attempts + 1), 250);
}

// El script de Google Maps lo carga globalmente el layout de web-customer.
function getGoogleMaps(): Promise<any> {
  if ((window as any).google?.maps) return Promise.resolve();
  if ((window as any).__tokenMapsReady) return (window as any).__tokenMapsReady;
  (window as any).__tokenMapsReady = new Promise<void>((resolve) => waitForGoogle(resolve));
  return (window as any).__tokenMapsReady;
}

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
  const [google, setGoogle] = useState<any>(null);

  useEffect(() => {
    if ((window as any).google?.maps) {
      setGoogle((window as any).google);
      return;
    }
    let cancelled = false;
    void getGoogleMaps().then(() => {
      if (!cancelled) setGoogle((window as any).google);
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
      bounds.extend({ lat: userPos.lat, lng: userPos.lng });
    }

    if (!origin) {
      map.setCenter({ lat: destination.lat, lng: destination.lng });
      map.setZoom(16);
    } else {
      map.fitBounds(bounds);
    }

    return () => {
      markers.forEach((m) => m.setMap(null));
      if (userMarker) userMarker.setMap(null);
      if (directionsRenderer) directionsRenderer.setMap(null);
      if (container) container.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google, origin?.lat, origin?.lng, destination.lat, destination.lng, userPos?.lat, userPos?.lng]);

  return <div ref={mapRef} style={{ width: '100%', height }} className="rounded-[20px]" />;
}