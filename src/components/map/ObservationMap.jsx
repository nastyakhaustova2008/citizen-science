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
import { EmptyState, ErrorBlock, Skeleton } from '../primitives';
import { MapPinOff } from 'lucide-react';
import { useLabPoints, useMeasurement } from '../../hooks/useMeasurements';
import { useAppData } from '../../context/AppDataContext';
import { formatNumber } from '../../lib/format';

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

/**
 * Map of a lab. Points are read page by page (lean rows, up to MAP_CAP — src/lib/measurementsApi.js);
 * above the cap a notice says how many are shown. The panel loads the full row of the chosen point.
 */
export default function ObservationMap({ observation, height = 520, initialPointId = null }) {
  const { t, locale } = useI18n();
  const res = useLabPoints(observation);
  if (res.error) return <ErrorBlock onRetry={res.reload} />;
  if (!res.data) return <Skeleton className="rounded-xl" style={{ height }} />;
  return (
    <div className="space-y-2">
      {res.data.capped && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper" role="status">
          {t('map.capped', {
            shown: formatNumber(res.data.points.length, { locale }),
            total: formatNumber(res.data.total, { locale }),
          })}
        </p>
      )}
      <PointsMap
        observation={observation}
        measurements={res.data.points}
        height={height}
        initialPointId={initialPointId}
      />
    </div>
  );
}

/** Full row of the chosen point for the panel (it may be beyond the map's cap: ?point=<id>). */
function SelectedPanel({ id, observation, onClose }) {
  const { data } = useMeasurement(id);
  const { loadAuthors } = useAppData();
  const authorId = data?.userId;
  useEffect(() => {
    if (authorId) loadAuthors([authorId]);
  }, [authorId, loadAuthors]);
  if (!data || data.observationId !== observation.id) return null;
  return <PointPanel measurement={data} observation={observation} onClose={onClose} />;
}

function PointsMap({ observation, measurements, height, initialPointId }) {
  const { t } = useI18n();
  const scale = observation.scale;

  const sortedDates = useMemo(
    () => [...new Set(measurements.map((m) => toISODate(m.timestamp)))].sort(),
    [measurements],
  );
  const [dateIdx, setDateIdx] = useState(0);
  useEffect(() => setDateIdx(sortedDates.length ? sortedDates.length - 1 : 0), [sortedDates.length]);

  // ?point=<id> (links from the admin comment lists) opens that point's panel.
  const [selectedId, setSelectedId] = useState(initialPointId || null);

  const cutoff = sortedDates[dateIdx];
  const visible = useMemo(() => {
    if (!cutoff || dateIdx >= sortedDates.length - 1) return measurements;
    return measurements.filter((m) => toISODate(m.timestamp) <= cutoff);
  }, [measurements, cutoff, dateIdx, sortedDates.length]);

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
              alt={m.value != null ? `${m.value} ${scale?.unit ?? ''}` : m.id}
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

      {selectedId && (
        <SelectedPanel id={selectedId} observation={observation} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
