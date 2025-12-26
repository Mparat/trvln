import { useEffect, useState, useMemo, useRef } from "react";
import { MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface Location {
  name: string;
  lat: number;
  lng: number;
  day?: number;
}

interface ItineraryMapProps {
  itinerary: string;
}

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

export function ItineraryMap({ itinerary }: ItineraryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Extract location names from itinerary
  const extractedPlaces = useMemo(() => {
    const places: { name: string; day: number }[] = [];
    const lines = itinerary.split('\n');
    let currentDay = 1;

    for (const line of lines) {
      const dayMatch = line.match(/Day\s+(\d+)/i);
      if (dayMatch) {
        currentDay = parseInt(dayMatch[1], 10);
      }

      const patterns = [
        /(?:visit|explore|see|tour|go to|head to|stop at|check out)\s+(?:the\s+)?([A-Z][a-zA-Z\s]+?)(?:\.|,|$)/gi,
        /([A-Z][a-zA-Z\s]+(?:Temple|Palace|Park|Museum|Market|Beach|Tower|Garden|Castle|Cathedral|Square|Bridge|District|Shrine))/g,
        /\*\*([A-Z][a-zA-Z\s]+)\*\*/g,
      ];

      for (const pattern of patterns) {
        const matches = line.matchAll(pattern);
        for (const match of matches) {
          const placeName = match[1]?.trim();
          if (placeName && placeName.length > 2 && placeName.length < 50) {
            if (!places.find(p => p.name.toLowerCase() === placeName.toLowerCase())) {
              places.push({ name: placeName, day: currentDay });
            }
          }
        }
      }
    }

    return places.slice(0, 15);
  }, [itinerary]);

  // Geocode the extracted places
  useEffect(() => {
    if (extractedPlaces.length === 0) {
      setIsLoading(false);
      return;
    }

    const geocodePlaces = async () => {
      setIsLoading(true);
      const geocoded: Location[] = [];

      for (const place of extractedPlaces) {
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place.name)}&limit=1`,
            { headers: { 'User-Agent': 'WanderlustAI/1.0' } }
          );
          const data = await response.json();
          
          if (data && data[0]) {
            geocoded.push({
              name: place.name,
              lat: parseFloat(data[0].lat),
              lng: parseFloat(data[0].lon),
              day: place.day,
            });
          }
          
          await new Promise(r => setTimeout(r, 300));
        } catch (error) {
          console.warn(`Failed to geocode: ${place.name}`);
        }
      }

      setLocations(geocoded);
      setIsLoading(false);
    };

    geocodePlaces();
  }, [extractedPlaces]);

  // Initialize and update map
  useEffect(() => {
    if (!mapContainerRef.current || locations.length === 0) return;

    // Clean up existing map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    // Create new map
    const map = L.map(mapContainerRef.current, {
      scrollWheelZoom: false,
    });

    mapRef.current = map;

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // Create custom marker icon with city label
    const createMarkerIcon = (day: number, name: string) => L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="display: flex; flex-direction: column; align-items: center; transform: translateX(-50%);">
          <div style="
            background: #C45D35;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 12px;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          ">${day}</div>
          <div style="
            background: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            color: #1a1a1a;
            white-space: nowrap;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            margin-top: 4px;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
          ">${name}</div>
        </div>
      `,
      iconSize: [120, 50],
      iconAnchor: [60, 14],
    });

    // Add markers
    const bounds = L.latLngBounds([]);
    locations.forEach((location) => {
      const marker = L.marker([location.lat, location.lng], {
        icon: createMarkerIcon(location.day || 1, location.name),
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-weight: 600;">${location.name}</div>
        ${location.day ? `<div style="font-size: 12px; color: #666;">Day ${location.day}</div>` : ''}
      `);

      bounds.extend([location.lat, location.lng]);
    });

    // Add route line
    if (locations.length > 1) {
      const latLngs: L.LatLngExpression[] = locations.map(loc => [loc.lat, loc.lng] as L.LatLngTuple);
      L.polyline(latLngs, {
        color: '#C45D35',
        weight: 3,
        opacity: 0.6,
        dashArray: '10, 10',
      }).addTo(map);
    }

    // Fit bounds
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    // Cleanup on unmount
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [locations]);

  if (isLoading && extractedPlaces.length > 0) {
    return (
      <div className="h-[400px] rounded-xl bg-muted flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading map locations...</p>
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="h-[300px] rounded-xl bg-muted flex items-center justify-center">
        <div className="text-center space-y-2">
          <MapPin className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No mappable locations found</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapContainerRef} 
      className="h-[400px] rounded-xl overflow-hidden shadow-medium"
    />
  );
}
