import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import { STATE_STYLE } from '../lib/format';
import { buildLine, headingAt, pointAt, slice, type RouteLine } from '../lib/geo';
import { ALERT_DISTANCE_M, ALERT_ETA_S } from '../lib/brand';

export interface MapSignal {
  id: number;
  lat: number;
  lng: number;
  label: string;
  order: number;
  state?: string;
}

/** Radius (m) inside which a junction gets alerted at this speed: whichever rule fires first. */
export function alertRadiusM(speedKmh: number): { radius: number; rule: 'eta' | 'distance' } {
  const byEta = (speedKmh / 3.6) * ALERT_ETA_S;
  return byEta > ALERT_DISTANCE_M ? { radius: byEta, rule: 'eta' } : { radius: ALERT_DISTANCE_M, rule: 'distance' };
}

// Standard OSM tiles (no key, no account), darkened with a CSS filter in
// index.css (.dark-map). Avoids depending on any paid/keyed basemap.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function junctionIcon(order: number, state: string) {
  const st = STATE_STYLE[state] ?? STATE_STYLE.PENDING!;
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="jn-wrap ${st.live ? 'live' : ''}" style="--jn-color:${st.color}"><div class="jn" style="background:${st.color}">${order}</div></div>`,
  });
}

const hospitalIcon = L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 16], html: '<div class="hosp">H</div>' });

function FitRoute({ line, fitKey }: { line: RouteLine; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (line.coords.length) map.fitBounds(L.latLngBounds(line.coords.map(([lng, lat]) => [lat, lng])), { padding: [40, 40] });
    // Refit only when the subject changes, not on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

/**
 * Ambulance, travelled path and alert zone, animated imperatively at frame
 * rate. Progress glides along the road between ~1 Hz server updates.
 */
function LiveLayer({ line, progressM, speedKmh, showZone, follow, label }: { line: RouteLine; progressM: number; speedKmh: number; showZone: boolean; follow: boolean; label?: string }) {
  const map = useMap();
  const state = useRef({ shown: progressM, from: progressM, to: progressM, start: 0, speedKmh });
  const layers = useRef<{ travelled: L.Polyline; zone: L.Polyline; zoneGlow: L.Polyline; amb: L.Marker } | null>(null);

  useEffect(() => {
    const travelled = L.polyline([], { color: '#334155', weight: 6, opacity: 0.95, interactive: false }).addTo(map);
    const zoneGlow = L.polyline([], { color: '#f5a524', weight: 18, opacity: 0.18, interactive: false, lineCap: 'round' }).addTo(map);
    const zone = L.polyline([], { color: '#f5a524', weight: 6, opacity: 0.95, dashArray: '14 10', className: 'zone-dash', interactive: false }).addTo(map);
    const amb = L.marker([0, 0], {
      zIndexOffset: 2000,
      icon: L.divIcon({
        className: '',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        html: `<div class="amb"><svg class="amb-arrow" viewBox="0 0 44 44"><path d="M22 1 L28 11 L16 11 Z" fill="#fff"/></svg><div class="amb-core"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e5383b" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div></div>`,
      }),
    }).addTo(map);
    if (label) amb.bindTooltip(label, { direction: 'top', offset: [0, -20] });
    layers.current = { travelled, zone, zoneGlow, amb };

    let raf = 0;
    const frame = (t: number) => {
      const s = state.current;
      const k = Math.min(1, (t - s.start) / 1000);
      s.shown = s.from + (s.to - s.from) * k;
      const pos = pointAt(line, s.shown);
      amb.setLatLng(pos);
      const arrow = (amb.getElement()?.querySelector('.amb-arrow') as SVGElement | null) ?? null;
      if (arrow) arrow.style.transform = `rotate(${headingAt(line, s.shown)}deg)`;
      travelled.setLatLngs(slice(line, 0, s.shown));
      if (showZone) {
        const { radius, rule } = alertRadiusM(s.speedKmh);
        const pts = slice(line, s.shown, s.shown + radius);
        const color = rule === 'eta' ? '#f5a524' : '#fb923c';
        zone.setLatLngs(pts).setStyle({ color });
        zoneGlow.setLatLngs(pts).setStyle({ color });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      travelled.remove();
      zone.remove();
      zoneGlow.remove();
      amb.remove();
      layers.current = null;
    };
  }, [map, line, showZone, label]);

  useEffect(() => {
    const s = state.current;
    s.from = s.shown;
    s.to = progressM;
    s.start = performance.now();
    s.speedKmh = speedKmh;
    if (follow) map.panTo(pointAt(line, progressM), { animate: true, duration: 1 });
  }, [progressM, speedKmh, follow, line, map]);

  return null;
}

export function MapView({
  routeCoords,
  fitKey,
  signals = [],
  hospital,
  progressM = null,
  speedKmh = 0,
  showZone = true,
  follow = false,
  ambulanceLabel,
  className = 'h-full w-full',
  children,
}: {
  routeCoords: [number, number][];
  fitKey: string;
  signals?: MapSignal[];
  hospital?: { lat: number; lng: number; label: string };
  progressM?: number | null;
  speedKmh?: number;
  showZone?: boolean;
  follow?: boolean;
  ambulanceLabel?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const line = useMemo(() => buildLine(routeCoords), [routeCoords]);
  const positions = useMemo(() => routeCoords.map(([lng, lat]): [number, number] => [lat, lng]), [routeCoords]);
  const center: [number, number] = positions[0] ?? [12.97, 77.6];

  return (
    <MapContainer center={center} zoom={14} className={`dark-map ${className}`} scrollWheelZoom zoomControl={false} attributionControl>
      <TileLayer attribution={ATTRIBUTION} url={TILES} maxZoom={19} />
      {/* Bottom-right keeps zoom clear of the HUD cards that sit top-left. */}
      <ZoomControl position="bottomright" />
      <FitRoute line={line} fitKey={fitKey} />
      {/* Route glow: wide soft line under a crisp core. */}
      <Polyline positions={positions} pathOptions={{ color: '#3b82f6', weight: 16, opacity: 0.16, interactive: false }} />
      <Polyline positions={positions} pathOptions={{ color: '#60a5fa', weight: 5, opacity: 0.95, interactive: false }} />
      {progressM !== null && line.length > 0 && (
        <LiveLayer line={line} progressM={progressM} speedKmh={speedKmh} showZone={showZone} follow={follow} label={ambulanceLabel} />
      )}
      {signals.map((s) => (
        <Marker key={`${s.id}-${s.state}`} position={[s.lat, s.lng]} icon={junctionIcon(s.order, s.state ?? 'PENDING')} zIndexOffset={500}>
          <Tooltip direction="top" offset={[0, -14]}>
            <b>{s.label}</b>
            <br />
            {(STATE_STYLE[s.state ?? 'PENDING'] ?? STATE_STYLE.PENDING!).label}
          </Tooltip>
        </Marker>
      ))}
      {hospital && (
        <Marker position={[hospital.lat, hospital.lng]} icon={hospitalIcon}>
          <Tooltip direction="top" offset={[0, -16]}>
            {hospital.label}
          </Tooltip>
        </Marker>
      )}
      {children}
    </MapContainer>
  );
}
