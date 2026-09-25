import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { coordLabel } from '../../lib/format';

const ISRAEL = [31.4, 34.9];

function Events({ onPick, onZoom }) {
  const map = useMapEvents({
    click(e) {
      onPick([Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5))], map.getZoom());
    },
    zoomend() {
      onZoom(map.getZoom());
    },
  });
  return null;
}

function FixSize() {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(id);
  }, [map]);
  return null;
}

/**
 * Map center + zoom of a lab: tap the map to set the center; the current zoom of the map is
 * the lab's zoom. `value` = [lat, lng] | null.
 */
export default function CenterPicker({ value, zoom, onChange, invalid, disabled }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div
        className={`overflow-hidden rounded-xl border ${invalid ? 'border-danger' : 'border-edge dark:border-white/10'}`}
        style={{ height: 280 }}
      >
        <MapContainer center={value || ISRAEL} zoom={value ? zoom : 7} className="h-full w-full" scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FixSize />
          {!disabled && (
            <Events
              onPick={(center, z) => onChange({ center, zoom: z })}
              onZoom={(z) => value && onChange({ center: value, zoom: z })}
            />
          )}
          {value && <Marker position={value} />}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        {value ? (
          <>
            <span dir="ltr" className="tnum">
              {coordLabel(value[0])}, {coordLabel(value[1])} · zoom {zoom}
            </span>
            {!disabled && (
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onChange({ center: null, zoom })}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                {t('labs.info.clearCenter')}
              </button>
            )}
          </>
        ) : (
          <span>{t('labs.info.centerHint')}</span>
        )}
      </div>
    </div>
  );
}
