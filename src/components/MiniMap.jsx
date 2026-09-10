import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { colorForValue } from '../data/metrics';

/**
 * Tiny non-interactive map preview for observation cards.
 * Built with the Leaflet API directly (no react-leaflet) so many
 * instances on the Home grid stay cheap.
 */
export default function MiniMap({
  center,
  points = [],
  metric,
  className = '',
  heightClass = 'h-28',
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      tap: false,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    const layer = L.featureGroup(
      points.map((p) =>
        L.circleMarker([p.lat, p.lng], {
          radius: 5,
          weight: 1.5,
          color: '#F7F4ED',
          fillColor: colorForValue(metric, p.value),
          fillOpacity: 0.9,
        }),
      ),
    ).addTo(map);

    if (points.length > 1) {
      map.fitBounds(layer.getBounds().pad(0.35), { animate: false });
    } else {
      map.setView(points[0] ? [points[0].lat, points[0].lng] : center, 11, { animate: false });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={elRef}
      className={`pointer-events-none w-full overflow-hidden rounded-lg border border-edge bg-paper-sunk dark:border-white/10 ${heightClass} ${className}`}
      role="img"
      aria-hidden="true"
    />
  );
}
