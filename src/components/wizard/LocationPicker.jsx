import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import { useEffect } from 'react';

function ClickCapture({ onPick }) {
  useMapEvents({
    click(e) {
      onPick([Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5))]);
    },
  });
  return null;
}

function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 15));
  }, [map, position]);
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(id);
  }, [map]);
  return null;
}

export default function LocationPicker({ center, zoom = 13, value, onPick, height = 300 }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-edge dark:border-white/10"
      style={{ height }}
    >
      <MapContainer center={value || center} zoom={zoom} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickCapture onPick={onPick} />
        <Recenter position={value} />
        {value && <Marker position={value} />}
      </MapContainer>
    </div>
  );
}
