/**
 * Leaflet ships its default marker icons as separate image files referenced
 * by URL, which breaks under bundlers. We draw our own divIcon markers for
 * measurements, but this keeps any stray default marker from 404-ing.
 */
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;

const pin = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
     <path d="M12.5 0C5.6 0 0 5.6 0 12.5 0 21 12.5 41 12.5 41S25 21 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#1F3A2E"/>
     <circle cx="12.5" cy="12.5" r="5" fill="#F7F4ED"/>
   </svg>`,
)}`;

L.Icon.Default.mergeOptions({
  iconUrl: pin,
  iconRetinaUrl: pin,
  shadowUrl: null,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
