import React, { useEffect, useRef } from 'react';
type CustomerOrderDetail = {
  id: string;
  address?: {
    latitude?: number;
    longitude?: number;
  } | null;
};

export default function LiveTrackingMap({
  order,
  driverLocation,
}: {
  order: CustomerOrderDetail;
  driverLocation: { lat: number; lng: number } | null;
}) {
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);

  useEffect(() => {
    if (!order) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current = null;
      }
      return;
    }

    const timer = setTimeout(() => {
      const google = (window as any).google;
      if (!google || !google.maps) return;

      const lat = order.address?.latitude;
      const lng = order.address?.longitude;

      if (!lat || !lng) return;

      try {
        if (!mapRef.current) {
          const mapEl = document.getElementById(`map-tracking-${order.id}`);
          if (!mapEl) return;
          mapRef.current = new google.maps.Map(mapEl, {
            center: { lat, lng },
            zoom: 15,
            mapTypeControl: false,
            streetViewControl: false,
            zoomControl: true,
            zoomControlOptions: {
              position: google.maps.ControlPosition.RIGHT_BOTTOM,
            },
          });

          const marker = new google.maps.Marker({
            position: { lat, lng },
            map: mapRef.current,
          });

          const infoWindow = new google.maps.InfoWindow({
            content: 'Punto de entrega'
          });
          infoWindow.open(mapRef.current, marker);
        } else {
          mapRef.current.setCenter({ lat, lng });
        }
      } catch (err) {
        console.error('Error al inicializar mapa:', err);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [order]);

  // Marcador del repartidor y transición fluida (gliding/path interpolation)
  useEffect(() => {
    const google = (window as any).google;
    if (!google || !google.maps || !mapRef.current || !driverLocation || !order) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setMap(null);
        driverMarkerRef.current = null;
      }
      return;
    }

    const { lat, lng } = driverLocation;

    if (!driverMarkerRef.current) {
      const icon = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="28" filter="drop-shadow(0px 2px 6px rgba(0,0,0,0.4))">🛵</text></svg>'),
        scaledSize: new google.maps.Size(32, 32),
        anchor: new google.maps.Point(16, 16)
      };

      driverMarkerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map: mapRef.current,
        icon: icon
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="color: #111111; font-family: sans-serif; padding: 4px; font-size: 13px; font-weight: 500;">
            <span>¡Tu repartidor está en camino! 🛵</span>
          </div>
        `
      });
      infoWindow.open(mapRef.current, driverMarkerRef.current);

      // Ajustar cámara para mostrar ambos al inicio
      const destLat = order.address?.latitude;
      const destLng = order.address?.longitude;
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: destLat, lng: destLng });
      bounds.extend({ lat, lng });
      mapRef.current.fitBounds(bounds, 40);
    } else {
      // Gliding suave del repartidor usando animación requestAnimationFrame
      const startLat = driverMarkerRef.current.getPosition().lat();
      const startLng = driverMarkerRef.current.getPosition().lng();
      const endLat = lat;
      const endLng = lng;

      let startTime: number | null = null;
      const duration = 2000;

      const animateMarker = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);

        const currentLat = startLat + (endLat - startLat) * progress;
        const currentLng = startLng + (endLng - startLng) * progress;

        if (driverMarkerRef.current) {
          driverMarkerRef.current.setPosition({ lat: currentLat, lng: currentLng });
        }

        if (progress < 1) {
          requestAnimationFrame(animateMarker);
        } else {
          if (mapRef.current) {
            const destLat = order.address?.latitude;
            const destLng = order.address?.longitude;
            const bounds = new google.maps.LatLngBounds();
            bounds.extend({ lat: destLat, lng: destLng });
            bounds.extend({ lat: endLat, lng: endLng });
            mapRef.current.fitBounds(bounds, 40);
          }
        }
      };

      requestAnimationFrame(animateMarker);
    }
  }, [driverLocation, order]);

  return <div id={`map-tracking-${order?.id}`} className="h-44 w-full rounded-2xl border border-black/[0.05] bg-neutral-50 z-0 animate-scale-up no-invert" />;
}
