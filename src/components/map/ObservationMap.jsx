import { useEffect, useMemo, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';

import { useI18n } from '../../i18n';
import { colorForValue } from '../../data/metrics';
import { toISODate } from '../../lib/format';
import Legend from './Legend';
import TimeSlider from './TimeSlider';
import PointPanel from './PointPanel';
import { EmptyState } from '../primitives';
import { MapPinOff } from 'lucide-react';

function markerIcon(color, selected) {
  return L.divIcon({
    className: 'measurement-marker',
    html: `<span style="
      display:block;width:${selected ? 20 : 15}px;height:${selected ? 20 : 15}px;
      border-radius:9999px;background:${color};
      border:2px solid #F7F4ED;
      box-shadow:0 0 0 ${selected ? 3 : 0}px rgba(139,111,71,.6);
    "></span>`,
    iconSize: [selected ? 20 : 15, selected ? 20 : 15],
    iconAnchor: [selected ? 10 : 7.5, selected ? 10 : 7.5],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds.pad(0.2), { animate: false });
  }, [map, points]);
  return null;
}

/** Keeps Leaflet sized correctly when the tab becomes visible. */
function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(id);
  }, [map]);
  return null;
}

export default function ObservationMap({ observation, measurements, height = 520 }) {
  const { t } = useI18n();
  const scale = observation.scale;

  const sortedDates = useMemo(
    () => [...new Set(measurements.map((m) => toISODate(m.timestamp)))].sort(),
    [measurements],
  );
  const [dateIdx, setDateIdx] = useState(0);
  useEffect(() => setDateIdx(sortedDates.length ? sortedDates.length - 1 : 0), [sortedDates.length]);

  const [selectedId, setSelectedId] = useState(null);

  const cutoff = sortedDates[dateIdx];
  const visible = useMemo(() => {
    if (!cutoff || dateIdx >= sortedDates.length - 1) return measurements;
    return measurements.filter((m) => toISODate(m.timestamp) <= cutoff);
  }, [measurements, cutoff, dateIdx, sortedDates.length]);

  const selected = measurements.find((m) => m.id === selectedId) || null;
  const handleSlider = useCallback((next) => setDateIdx(next), []);

  if (!measurements.length) {
    return (
      <div style={{ height }} className="grid place-items-center">
        <EmptyState icon={MapPinOff} title={t('map.noData')} />
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-edge dark:border-white/10"
      style={{ height }}
      role="region"
      aria-label={t('a11y.mapRegion')}
    >
      <MapContainer
        center={observation.center}
        zoom={observation.zoom}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <InvalidateOnMount />
        <FitBounds points={measurements} />
        <MarkerClusterGroup chunkedLoading maxClusterRadius={48} showCoverageOnHover={false}>
          {visible.map((m) => (
            <Marker
              key={m.id}
              position={[m.lat, m.lng]}
              icon={markerIcon(colorForValue(scale, m.value), m.id === selectedId)}
              eventHandlers={{ click: () => setSelectedId(m.id) }}
              keyboard
              alt={m.value != null ? `${m.value} ${scale?.unit ?? ''}` : m.placeLabel || m.id}
            />
          ))}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Legend — top start */}
      <div className="pointer-events-none absolute start-3 top-3 z-[800]">
        <Legend scale={scale} />
      </div>

      {/* Time slider — bottom */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[800]">
        <TimeSlider
          dates={sortedDates}
          value={dateIdx}
          onChange={handleSlider}
          shownCount={visible.length}
          totalCount={measurements.length}
        />
      </div>

      {selected && (
        <PointPanel measurement={selected} observation={observation} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
