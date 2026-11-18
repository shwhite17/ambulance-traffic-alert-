import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import { STATE_STYLE } from '../lib/format';

export interface MapSignal {
  key: string | number;
  lat: number;
  lng: number;
  label: string;
  state?: string;
}
export interface MapAmbulance {
  key: string | number;
  lat: number;
  lng: number;
  label: string;
}

const ambIcon = L.divIcon({ className: 'amb-marker', html: '🚑', iconSize: [30, 30], iconAnchor: [15, 15] });
const hospIcon = L.divIcon({ className: 'amb-marker', html: '🏥', iconSize: [30, 30], iconAnchor: [15, 15] });

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    // Refit only when the subject changes, not on every location update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function Follow({ target }: { target: MapAmbulance | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.panTo([target.lat, target.lng], { animate: true });
  }, [target?.lat, target?.lng, map]);
  return null;
}

export function MapView({
  routes = [],
  signals = [],
  ambulances = [],
  hospitals = [],
  fitKey,
  follow = false,
  className = 'h-full w-full',
}: {
  routes?: { key: string | number; coordinates: [number, number][] }[];
  signals?: MapSignal[];
  ambulances?: MapAmbulance[];
  hospitals?: { key: string; lat: number; lng: number; label: string }[];
  fitKey: string;
  follow?: boolean;
  className?: string;
}) {
  const fitPoints = useMemo(
    () => routes.flatMap((r) => r.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
    [routes],
  );
  const center: LatLngExpression = fitPoints[0] ?? [12.97, 77.6];

  return (
    <MapContainer center={center} zoom={14} className={className} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={fitPoints} fitKey={fitKey} />
      {follow && <Follow target={ambulances[0]} />}
      {routes.map((r) => (
        <Polyline key={r.key} positions={r.coordinates.map(([lng, lat]): [number, number] => [lat, lng])} pathOptions={{ color: '#2563eb', weight: 6, opacity: 0.7 }} />
      ))}
      {signals.map((s) => {
        const st = STATE_STYLE[s.state ?? 'PENDING'] ?? STATE_STYLE.PENDING!;
        return (
          <CircleMarker
            key={s.key}
            center={[s.lat, s.lng]}
            radius={11}
            pathOptions={{ color: '#0f172a', weight: 2, fillColor: st.color, fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <b>{s.label}</b>
              <br />
              {st.label}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {hospitals.map((h) => (
        <Marker key={h.key} position={[h.lat, h.lng]} icon={hospIcon}>
          <Tooltip>{h.label}</Tooltip>
        </Marker>
      ))}
      {ambulances.map((a) => (
        <Marker key={a.key} position={[a.lat, a.lng]} icon={ambIcon} zIndexOffset={1000}>
          <Tooltip>{a.label}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
