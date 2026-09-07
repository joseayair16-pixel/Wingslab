'use client';

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Merge,
  RefreshCw,
  Undo2,
  Ship,
  Flag,
  Map as MapIcon,
  Car,
  Check,
} from 'lucide-react';
import { ensureGoogleMapsScript, getGoogleMaps } from '../lib/googleMaps';

type Point = { lat: number; lng: number };

export type TurnByTurnDestination = {
  lat: number;
  lng: number;
  label: string;
  emoji: string;
};

type Props = {
  origin: Point | null;
  destination: TurnByTurnDestination;
  initialDriverPos?: Point | null;
  onExit: () => void;
  dark?: boolean;
};

const LIGHT_STYLES: unknown[] = [
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

const DARK_STYLES: unknown[] = [
  { elementType: 'geometry', stylers: [{ color: '#17181c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#17181c' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#27272a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#26272c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2d2f36' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#71717a' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#71717a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#1b2027' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3f4a59' }] },
];

function buildPinIcon(google: any, bg: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 1C11.7 1 5 7.7 5 16c0 9 15 31 15 31s15-22 15-31C35 7.7 28.3 1 20 1Z" fill="${bg}" stroke="#ffffff" stroke-width="2"/><circle cx="20" cy="15.5" r="10.5" fill="#ffffff"/><circle cx="20" cy="15.5" r="5" fill="${bg}"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(40, 48),
    anchor: new google.maps.Point(20, 44),
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

// Solo recalculamos la ruta (Directions = API de pago) si el repartidor se
// desvía demasiado del origen del trayecto. Cada giro/ETA se deriva de esa
// misma respuesta, sin llamadas adicionales.
const ROUTE_RECALC_DISTANCE_M = 800;

const MANEUVER_ICON: Record<string, LucideIcon> = {
  'turn-slight-left': ArrowUpLeft,
  'turn-sharp-left': ArrowLeft,
  'turn-left': ArrowLeft,
  'turn-slight-right': ArrowUpRight,
  'turn-sharp-right': ArrowRight,
  'turn-right': ArrowRight,
  'straight': ArrowUp,
  'merge': Merge,
  'roundabout-left': RefreshCw,
  'roundabout-right': RefreshCw,
  'uturn-left': Undo2,
  'uturn-right': Undo2,
  'fork-left': ArrowUpLeft,
  'fork-right': ArrowUpRight,
  'ramp-left': ArrowUpLeft,
  'ramp-right': ArrowUpRight,
  'keep-left': ArrowUpLeft,
  'keep-right': ArrowUpRight,
  'ferry': Ship,
  'destination': Flag,
};

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export default function DriverTurnByTurnOverlay({
  destination,
  initialDriverPos,
  onExit,
  dark = false,
}: Props) {
  const mapElIdRef = useRef<string>(`sadel-nav-${Math.random().toString(36).slice(2)}`);
  const mapRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const routeOriginRef = useRef<Point | null>(null);
  // Ruta proyectada: puntos del overview + longitud acumulada (1 solo Directions).
  const pathPointsRef = useRef<Point[]>([]);
  const pathCumLenRef = useRef<number[]>([]);
  const pathTotalLenRef = useRef(0);
  const stepDistAlongRef = useRef<number[]>([]);
  const stepDurationMinRef = useRef<number>(0);
  const stepTotalDistRef = useRef(0);
  const stepsRef = useRef<any[]>([]);
  const destinationRef = useRef<TurnByTurnDestination>(destination);
  const watchIdRef = useRef<number | null>(null);
  const manualPanRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [driverPos, setDriverPos] = useState<Point | null>(initialDriverPos || null);
  const [nav, setNav] = useState<{
    emoji: LucideIcon;
    text: string;
    distToTurnM: number;
    remainingM: number;
    remainingMin: number;
    progress: number;
    arrived: boolean;
  } | null>(null);


  destinationRef.current = destination;

  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      map.setMap(null);
    }
    if (routeRef.current) {
      routeRef.current.setMap(null);
      routeRef.current = null;
    }
    if (driverMarkerRef.current) {
      driverMarkerRef.current.setMap(null);
      driverMarkerRef.current = null;
    }
    if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }
    mapRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar Google Maps de forma perezosa (reutiliza el script si ya existe).
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

  // Posición inicial: usar la pasada (restaurante/ticket) o pedir GPS.
  // Reintentable desde la UI (botón "Reintentar") — antes un solo fallo del
  // GPS dejaba el overlay en "Calculando ruta…" para siempre.
  const requestInitialLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError(true);
      return;
    }
    setGpsError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDriverPos({
          lat: parseFloat(pos.coords.latitude.toFixed(6)),
          lng: parseFloat(pos.coords.longitude.toFixed(6)),
        });
      },
      () => setGpsError(true),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  };

  useEffect(() => {
    if (driverPos || typeof navigator === 'undefined' || !navigator.geolocation) return;
    requestInitialLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proyección de un punto sobre el camino proyectado (overview path).
  const projectOnPath = (p: Point) => {
    const pts = pathPointsRef.current;
    const cum = pathCumLenRef.current;
    const total = pathTotalLenRef.current;
    if (pts.length < 2 || total === 0) return null;

    let bestDist = Infinity;
    let bestAlong = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = cum[i + 1] - cum[i];
      if (segLen === 0) continue;
      const t = Math.max(0, Math.min(1, ((p.lat - a.lat) * (b.lat - a.lat) + (p.lng - a.lng) * (b.lng - a.lng)) / (segLen * segLen)));
      const projLat = a.lat + t * (b.lat - a.lat);
      const projLng = a.lng + t * (b.lng - a.lng);
      const d = haversineMeters(p, { lat: projLat, lng: projLng });
      if (d < bestDist) {
        bestDist = d;
        bestAlong = cum[i] + segLen * t;
      }
    }
    return { distanceToPathM: bestDist, along: bestAlong, remainingM: Math.max(0, total - bestAlong) };
  };

  // Inicializar el mapa.
  useEffect(() => {
    if (!mapReady) return;

    let cancelled = false;

    const createMap = (google: any) => {
      const mapEl = document.getElementById(mapElIdRef.current);
      if (!mapEl || mapRef.current) return;

      const dest = destinationRef.current;
      const map = new google.maps.Map(mapEl, {
        center: { lat: dest.lat, lng: dest.lng },
        zoom: 15,
        styles: dark ? DARK_STYLES : LIGHT_STYLES,
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

      // Si el repartidor toca el mapa, detiene el auto-follow (como Uber).
      google.maps.event.addListener(map, 'dragstart', () => {
        manualPanRef.current = true;
      });

      destMarkerRef.current = new google.maps.Marker({
        position: { lat: dest.lat, lng: dest.lng },
        map,
        icon: buildPinIcon(google, '#0f172a'),
        zIndex: 2,
        title: dest.label,
      });

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
  }, [mapReady, dark]);

  const requestRoute = () => {
    const google = getGoogleMaps();
    const map = mapRef.current;
    const dest = destinationRef.current;
    if (!google?.maps || !map || !dest) return;

    const originPoint = driverPos;
    if (!originPoint) return;

    // Cache: no recalcular si el destino no cambió y no nos desviamos >800m.
    const lastOrigin = routeOriginRef.current;
    const movedFromRouteOrigin =
      !lastOrigin || haversineMeters(lastOrigin, originPoint) >= ROUTE_RECALC_DISTANCE_M;

    if (routeRef.current && !movedFromRouteOrigin) {
      return;
    }

    // Ahorro de datos real: con la pantalla oculta no tiene sentido gastar la
    // llamada de Directions (API de pago). Se recalcula al volver al frente.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    setRouteError(false);
    const directions = new google.maps.DirectionsService();
    directions.route(
      {
        origin: { lat: originPoint.lat, lng: originPoint.lng },
        destination: { lat: dest.lat, lng: dest.lng },
        travelMode: google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false,
      },
      (result: any, status: string) => {
        if (status !== 'OK' || !result) {
          // Antes esto era silencioso: el overlay quedaba en loading infinito.
          setRouteError(true);
          return;
        }
        routeOriginRef.current = originPoint;

        if (routeRef.current) {
          routeRef.current.setMap(null);
          routeRef.current = null;
        }
        routeRef.current = new google.maps.DirectionsRenderer({
          map,
          directions: result,
          suppressMarkers: true,
          polylineOptions: {
            strokeColor: dark ? '#38bdf8' : '#0ea5e9',
            strokeOpacity: 0.9,
            strokeWeight: 6,
          },
          preserveViewport: true,
        });

        const leg = result.routes?.[0]?.legs?.[0];
        if (leg?.distance?.value != null && leg?.duration?.value != null) {
          stepTotalDistRef.current = leg.distance.value;
          stepDurationMinRef.current = Math.round(leg.duration.value / 60);
        }

        // Curva proyectada del trayecto (mismo Directions, 0 coste extra).
        const overview = result.routes?.[0]?.overview_path || [];
        const pts: Point[] = overview.map((ll: any) => ({ lat: ll.lat(), lng: ll.lng() }));
        pathPointsRef.current = pts;
        pathCumLenRef.current = [0];
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          acc += haversineMeters(pts[i - 1], pts[i]);
          pathCumLenRef.current.push(acc);
        }
        pathTotalLenRef.current = acc;

        // Distancia a lo largo del trayecto de cada paso (para saber el giro actual).
        const steps = leg?.steps || [];
        stepsRef.current = steps;
        const stepDist: number[] = [];
        let stepsCum = 0;
        for (let i = 0; i < steps.length; i++) {
          if (i > 0) {
            const prev = steps[i - 1]?.start_location;
            const cur = steps[i]?.start_location;
            if (prev && cur) stepsCum += haversineMeters({ lat: prev.lat(), lng: prev.lng() }, { lat: cur.lat(), lng: cur.lng() });
          }
          stepDist.push(stepsCum);
        }
        stepDistAlongRef.current = stepDist;

        if (!driverMarkerRef.current) {
          driverMarkerRef.current = new google.maps.Marker({
            position: { lat: originPoint.lat, lng: originPoint.lng },
            map,
            icon: buildDriverIcon(google),
            zIndex: 3,
          });
        }

        // Encajar el mapa a la ruta completa al abrir (una sola vez).
        const bounds = new google.maps.LatLngBounds();
        bounds.extend({ lat: originPoint.lat, lng: originPoint.lng });
        bounds.extend({ lat: dest.lat, lng: dest.lng });
        map.fitBounds(bounds, 70);
        if (map.getZoom() > 16) map.setZoom(16);
        manualPanRef.current = false;
      }
    );
  };

  // Seguir la posición del repartidor con watchPosition propio.
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    let hasValidFix = false;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        // Ahorro: con la app oculta no actualizamos estado (ni mapa ni ruta).
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        hasValidFix = true;
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setDriverPos((prev) => {
          if (prev && haversineMeters(prev, { lat, lng }) < 8) return prev;
          return { lat, lng };
        });
        setGpsError(false);
      },
      () => {
        // Solo mostramos error si aún no tenemos ninguna posición válida.
        if (!hasValidFix) setGpsError(true);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
    watchIdRef.current = id;
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // Auto-follow: mover marcador y centrar el mapa con el repartidor.
  useEffect(() => {
    if (!driverPos) return;
    const google = getGoogleMaps();

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition({ lat: driverPos.lat, lng: driverPos.lng });
    } else if (mapRef.current && google?.maps) {
      driverMarkerRef.current = new google.maps.Marker({
        position: { lat: driverPos.lat, lng: driverPos.lng },
        map: mapRef.current,
        icon: buildDriverIcon(google),
        zIndex: 3,
      });
    }

    if (mapRef.current && !manualPanRef.current) {
      mapRef.current.panTo({ lat: driverPos.lat, lng: driverPos.lng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos]);

  // Calcular estado de navegación: progreso, giro actual y llegada.
  useEffect(() => {
    if (!driverPos || pathTotalLenRef.current === 0) return;

    const dest = destinationRef.current;
    const proj = projectOnPath(driverPos);
    if (!proj) return;

    const arrived =
      proj.remainingM < 60 || haversineMeters(driverPos, dest) < 60;

    // Paso actual: último paso cuyo inicio ya pasamos a lo largo del trayecto.
    const steps = stepsRef.current;
    let currentIdx = steps.length - 1;
    for (let i = 0; i < steps.length; i++) {
      if (proj.along >= (stepDistAlongRef.current[i] || 0) - 15) {
        currentIdx = i;
      } else {
        break;
      }
    }
    // Instrucción: el giro a ejecutar es el paso actual (o el próximo si ya lo iniciamos).
    const showIdx = Math.min(currentIdx + 1, steps.length - 1);
    const step = steps[showIdx];

    let distToTurn = 0;
    if (step) {
      const turnAt = showIdx < steps.length ? steps[showIdx]?.start_location : null;
      if (turnAt) {
        distToTurn = haversineMeters(driverPos, { lat: turnAt.lat(), lng: turnAt.lng() });
      } else {
        distToTurn = proj.remainingM;
      }
    }

    const progress = Math.min(1, Math.max(0, proj.along / pathTotalLenRef.current));
    const remainingMin = stepTotalDistRef.current > 0
      ? Math.max(1, Math.round((stepDurationMinRef.current * proj.remainingM) / stepTotalDistRef.current))
      : 0;

    const maneuver = step?.maneuver || (currentIdx === steps.length - 1 ? 'destination' : 'straight');

    setNav({
      emoji: MANEUVER_ICON[maneuver as string] || ArrowUp,
      text: arrived
        ? 'Llegaste a tu destino'
        : step
          ? stripHtml(step.instructions || 'Continúa por la calle')
          : 'Dirígete al destino',
      distToTurnM: arrived ? 0 : Math.round(distToTurn),
      remainingM: Math.round(proj.remainingM),
      remainingMin,
      progress,
      arrived,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos]);

  // Recálculo de ruta si el repartidor se desvía del trayecto.
  useEffect(() => {
    const originPoint = driverPos;
    if (!originPoint || !mapReady) return;
    const timer = setTimeout(() => {
      const lastRoute = routeOriginRef.current;
      if (!lastRoute) {
        requestRoute();
        return;
      }
      if (haversineMeters(lastRoute, originPoint) >= ROUTE_RECALC_DISTANCE_M) {
        requestRoute();
      }
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos, mapReady]);

  // Ahorro de datos: la ruta no se pide con la app oculta; al retomar el
  // primer plano, si la ruta quedó pendiente o ya no refleja la posición,
  // se recalcula aquí.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (driverPos && mapRef.current) requestRoute();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos, mapReady]);

  const dest = destinationRef.current;
  const openGoogleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
  const openWazeUrl = `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`;

  const handleExit = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    onExit();
  };

  return (
    <div className={`fixed inset-0 z-[80] flex flex-col ${dark ? 'bg-black text-white' : 'bg-surface text-foreground'}`}>
      <div id={mapElIdRef.current} className="absolute inset-0 z-0" />

      {/* Header flotante */}
      <div className="absolute inset-x-0 top-0 z-[5] p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={handleExit}
            className={`flex h-11 w-11 items-center justify-center rounded-2xl border shadow-lg backdrop-blur transition active:scale-95 ${
              dark
                ? 'border-white/10 bg-zinc-900/90 text-white'
                : 'border-black/[0.06] bg-surface/95 text-foreground'
            }`}
            aria-label="Salir de la navegación"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          {nav && !nav.arrived && (
            <div className={`rounded-2xl border px-3.5 py-2 shadow-lg backdrop-blur ${dark ? 'border-white/10 bg-zinc-900/90' : 'border-black/[0.06] bg-surface/95'}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${dark ? 'text-zinc-400' : 'text-muted'}`}>
                Llegada estimada
              </p>
              <p className={`text-sm font-black mt-0.5 ${dark ? 'text-white' : 'text-foreground'}`}>
                {formatDistance(nav.remainingM)} · {nav.remainingMin} min
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Botón re-centrar cuando el repartidor movió el mapa */}
      {manualPanRef.current && (
        <button
          type="button"
          onClick={() => {
            manualPanRef.current = false;
            if (driverPos && mapRef.current) {
              mapRef.current.panTo({ lat: driverPos.lat, lng: driverPos.lng });
              mapRef.current.setZoom(16);
            }
          }}
          className={`absolute right-4 bottom-44 z-[5] flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-bold shadow-lg backdrop-blur transition active:scale-95 ${
            dark ? 'border-white/10 bg-zinc-900/90 text-white' : 'border-black/[0.06] bg-surface/95 text-foreground'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
          </svg>
          Centrar
        </button>
      )}

      {/* Bottom card: indicación turn-by-turn */}
      <div className="absolute inset-x-0 bottom-0 z-[5] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className={`rounded-[24px] border p-4 shadow-2xl ${dark ? 'border-white/10 bg-zinc-900/95' : 'border-black/[0.06] bg-surface/95'}`}>
          {loadError ? (
            <div className="space-y-2">
              <p className={`text-sm font-bold ${dark ? 'text-white' : 'text-foreground'}`}>
                No se pudo cargar el mapa.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={openGoogleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-500 py-3 text-xs font-bold text-white shadow-lg shadow-sky-500/30"
                >
                  <MapIcon className="h-4 w-4" /> Google Maps
                </a>
                <a
                  href={openWazeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-3 text-xs font-bold ${
                    dark ? 'border-white/10 text-white' : 'border-black/10 text-foreground'
                  }`}
                >
                  <Car className="h-4 w-4" /> Waze
                </a>
              </div>
              <button
                type="button"
                onClick={handleExit}
                className={`w-full rounded-xl border py-3 text-xs font-bold ${dark ? 'border-white/10 text-zinc-300' : 'border-black/10 text-muted'}`}
              >
                Salir
              </button>
            </div>
          ) : nav?.arrived ? (
            <>
              <div className="flex flex-col items-center py-2 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                  <Flag className="h-9 w-9" />
                </span>
                <p className={`text-lg font-black mt-3 ${dark ? 'text-white' : 'text-foreground'}`}>
                  ¡Llegaste a tu destino!
                </p>
                <p className={`text-sm mt-1 ${dark ? 'text-zinc-400' : 'text-muted'}`}>
                  {dest.label}
                </p>
                <button
                  type="button"
                  onClick={handleExit}
                  className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-black text-white shadow-lg shadow-emerald-500/30 transition active:scale-[0.97]"
                >
                  <Check className="h-4 w-4" /> Continuar
                </button>
              </div>
            </>
          ) : nav ? (
            <>
              {/* Barra de progreso */}
              <div className={`h-1 w-full overflow-hidden rounded-full ${dark ? 'bg-surface/10' : 'bg-black/10'}`}>
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-700"
                  style={{ width: `${Math.round(nav.progress * 100)}%` }}
                />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-2xl">
                  <nav.emoji className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${dark ? 'text-zinc-400' : 'text-muted'}`}>
                    {nav.distToTurnM > 0 ? `Gira en ${formatDistance(nav.distToTurnM)}` : 'Siguiente'}
                  </p>
                  <p className={`text-base font-black leading-snug mt-0.5 ${dark ? 'text-white' : 'text-foreground'}`}>
                    {nav.text}
                  </p>
                </div>
              </div>

              <div className={`mt-3 grid grid-cols-2 gap-2 border-t pt-3 ${dark ? 'border-white/10' : 'border-black/5'}`}>
                <a
                  href={openGoogleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-bold transition active:scale-95 ${dark ? 'border-white/10 text-zinc-200' : 'border-black/10 text-foreground'}`}
                >
                  <MapIcon className="h-4 w-4" /> Google Maps
                </a>
                <a
                  href={openWazeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-bold transition active:scale-95 ${dark ? 'border-white/10 text-zinc-200' : 'border-black/10 text-foreground'}`}
                >
                  <Car className="h-4 w-4" /> Waze
                </a>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {gpsError || routeError ? (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-xl">
                    ⚠️
                  </span>
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500/15 border-t-sky-500" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-black ${dark ? 'text-white' : 'text-foreground'}`}>
                    {gpsError
                      ? 'No pudimos obtener tu ubicación'
                      : routeError
                        ? 'No se pudo calcular la ruta'
                        : driverPos
                          ? 'Calculando la mejor ruta…'
                          : 'Obteniendo tu ubicación…'}
                  </p>
                  <p className={`text-xs mt-0.5 ${dark ? 'text-zinc-400' : 'text-muted'}`}>
                    {gpsError
                      ? 'Activa el GPS y permite la ubicación para navegar. Si la bloqueaste, actívala en los ajustes del navegador.'
                      : routeError
                        ? 'Verifica tu conexión o abre la ruta en una app externa.'
                        : `Dirígete a: ${dest.label}`}
                  </p>
                </div>
              </div>

              {(gpsError || routeError) && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (gpsError) {
                        requestInitialLocation();
                      } else {
                        routeOriginRef.current = null;
                        requestRoute();
                      }
                    }}
                    className="w-full rounded-xl bg-sky-600 py-3 text-xs font-bold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.97]"
                  >
                    Reintentar
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={openGoogleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-500 py-2.5 text-[11px] font-bold text-white"
                    >
                      <MapIcon className="h-4 w-4" /> Google Maps
                    </a>
                    <a
                      href={openWazeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-bold ${
                        dark ? 'border-white/10 text-white' : 'border-black/10 text-foreground'
                      }`}
                    >
                      <Car className="h-4 w-4" /> Waze
                    </a>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}