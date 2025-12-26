import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { Icon, LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";

interface Location {
  name: string;
  lat: number;
  lng: number;
  day?: number;
}

interface ItineraryMapProps {
  itinerary: string;
}

// Custom marker icon
const createMarkerIcon = (day: number) => new Icon({
  iconUrl: `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="32" height="42">
      <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="#C45D35"/>
      <circle cx="16" cy="14" r="8" fill="white"/>
      <text x="16" y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="#C45D35">${day}</text>
    </svg>
  `)}`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -42],
});

function FitBounds({ locations }: { locations: Location[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (locations.length > 0) {
      const bounds = new LatLngBounds(
        locations.map(loc => [loc.lat, loc.lng])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [locations, map]);
  
  return null;
}

export function ItineraryMap({ itinerary }: ItineraryMapProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Extract location names from itinerary
  const extractedPlaces = useMemo(() => {
    const places: { name: string; day: number }[] = [];
    const lines = itinerary.split('\n');
    let currentDay = 1;

    for (const line of lines) {
      // Track current day
      const dayMatch = line.match(/Day\s+(\d+)/i);
      if (dayMatch) {
        currentDay = parseInt(dayMatch[1], 10);
      }

      // Look for locations - simple pattern matching
      // Match patterns like "Visit [Place]", "Explore [Place]", "[Place] Temple", etc.
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
            // Avoid duplicates
            if (!places.find(p => p.name.toLowerCase() === placeName.toLowerCase())) {
              places.push({ name: placeName, day: currentDay });
            }
          }
        }
      }
    }

    return places.slice(0, 15); // Limit to 15 places for performance
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
          
          // Rate limit to respect Nominatim ToS
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
        <p className="text-sm text-muted-foreground">No mappable locations found in itinerary</p>
      </div>
    );
  }

  const polylinePositions = locations.map(loc => [loc.lat, loc.lng] as [number, number]);

  return (
    <div className="h-[400px] rounded-xl overflow-hidden shadow-medium">
      <MapContainer
        center={[locations[0].lat, locations[0].lng]}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Route line */}
        <Polyline
          positions={polylinePositions}
          pathOptions={{
            color: '#C45D35',
            weight: 3,
            opacity: 0.6,
            dashArray: '10, 10',
          }}
        />

        {/* Markers */}
        {locations.map((location, index) => (
          <Marker
            key={index}
            position={[location.lat, location.lng]}
            icon={createMarkerIcon(location.day || index + 1)}
          >
            <Popup>
              <div className="font-medium">{location.name}</div>
              {location.day && (
                <div className="text-sm text-muted-foreground">Day {location.day}</div>
              )}
            </Popup>
          </Marker>
        ))}

        <FitBounds locations={locations} />
      </MapContainer>
    </div>
  );
}
