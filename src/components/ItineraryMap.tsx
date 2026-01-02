import { useEffect, useState, useMemo, useRef } from "react";
import { MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface Location {
  name: string;
  lat: number;
  lng: number;
  order: number;
  type: 'city' | 'landmark' | 'place';
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

// Known cities with coordinates for faster lookup
const cityCoordinates: Record<string, { lat: number; lng: number }> = {
  'tokyo': { lat: 35.6762, lng: 139.6503 },
  'kyoto': { lat: 35.0116, lng: 135.7681 },
  'osaka': { lat: 34.6937, lng: 135.5023 },
  'new york': { lat: 40.7128, lng: -74.0060 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'paris': { lat: 48.8566, lng: 2.3522 },
  'rome': { lat: 41.9028, lng: 12.4964 },
  'barcelona': { lat: 41.3851, lng: 2.1734 },
  'amsterdam': { lat: 52.3676, lng: 4.9041 },
  'berlin': { lat: 52.5200, lng: 13.4050 },
  'munich': { lat: 48.1351, lng: 11.5820 },
  'singapore': { lat: 1.3521, lng: 103.8198 },
  'hong kong': { lat: 22.3193, lng: 114.1694 },
  'bangkok': { lat: 13.7563, lng: 100.5018 },
  'seoul': { lat: 37.5665, lng: 126.9780 },
  'sydney': { lat: -33.8688, lng: 151.2093 },
  'melbourne': { lat: -37.8136, lng: 144.9631 },
  'dubai': { lat: 25.2048, lng: 55.2708 },
  'istanbul': { lat: 41.0082, lng: 28.9784 },
  'cairo': { lat: 30.0444, lng: 31.2357 },
  'cape town': { lat: -33.9249, lng: 18.4241 },
  'rio de janeiro': { lat: -22.9068, lng: -43.1729 },
  'buenos aires': { lat: -34.6037, lng: -58.3816 },
  'mexico city': { lat: 19.4326, lng: -99.1332 },
  'toronto': { lat: 43.6532, lng: -79.3832 },
  'vancouver': { lat: 49.2827, lng: -123.1207 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'miami': { lat: 25.7617, lng: -80.1918 },
  'seattle': { lat: 47.6062, lng: -122.3321 },
  'denver': { lat: 39.7392, lng: -104.9903 },
  'boston': { lat: 42.3601, lng: -71.0589 },
  'washington': { lat: 38.9072, lng: -77.0369 },
  'washington dc': { lat: 38.9072, lng: -77.0369 },
  'atlanta': { lat: 33.7490, lng: -84.3880 },
  'dallas': { lat: 32.7767, lng: -96.7970 },
  'houston': { lat: 29.7604, lng: -95.3698 },
  'phoenix': { lat: 33.4484, lng: -112.0740 },
  'las vegas': { lat: 36.1699, lng: -115.1398 },
  'san diego': { lat: 32.7157, lng: -117.1611 },
  'portland': { lat: 45.5152, lng: -122.6784 },
  'philadelphia': { lat: 39.9526, lng: -75.1652 },
  'lisbon': { lat: 38.7223, lng: -9.1393 },
  'madrid': { lat: 40.4168, lng: -3.7038 },
  'vienna': { lat: 48.2082, lng: 16.3738 },
  'prague': { lat: 50.0755, lng: 14.4378 },
  'budapest': { lat: 47.4979, lng: 19.0402 },
  'athens': { lat: 37.9838, lng: 23.7275 },
  'dublin': { lat: 53.3498, lng: -6.2603 },
  'edinburgh': { lat: 55.9533, lng: -3.1883 },
  'zurich': { lat: 47.3769, lng: 8.5417 },
  'geneva': { lat: 46.2044, lng: 6.1432 },
  'copenhagen': { lat: 55.6761, lng: 12.5683 },
  'stockholm': { lat: 59.3293, lng: 18.0686 },
  'oslo': { lat: 59.9139, lng: 10.7522 },
  'helsinki': { lat: 60.1699, lng: 24.9384 },
  'nara': { lat: 34.6851, lng: 135.8050 },
  'hakone': { lat: 35.2324, lng: 139.1069 },
  'hiroshima': { lat: 34.3853, lng: 132.4553 },
  'nagoya': { lat: 35.1815, lng: 136.9066 },
  'fukuoka': { lat: 33.5904, lng: 130.4017 },
  'sapporo': { lat: 43.0618, lng: 141.3545 },
  'nikko': { lat: 36.7199, lng: 139.6982 },
  'kanazawa': { lat: 36.5613, lng: 136.6562 },
  'takayama': { lat: 36.1461, lng: 137.2522 },
  'mt fuji': { lat: 35.3606, lng: 138.7274 },
  'mount fuji': { lat: 35.3606, lng: 138.7274 },
};

export function ItineraryMap({ itinerary }: ItineraryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Extract all key locations from itinerary (cities, landmarks, places)
  const extractedLocations = useMemo(() => {
    const places: { name: string; order: number; type: 'city' | 'landmark' | 'place' }[] = [];
    const seenPlaces = new Set<string>();
    const lines = itinerary.split('\n');
    let order = 1;
    let currentCity = '';

    // First pass: Extract cities from Day headers
    for (const line of lines) {
      const dayMatch = line.match(/Day\s+\d+[:\—–-]\s*\*?\*?([A-Z][a-zA-Z\s]+)\*?\*?/i);
      if (dayMatch) {
        const cityName = dayMatch[1].trim().toLowerCase().replace(/\s*—.*$/, '').replace(/\s*-.*$/, '');
        if (cityCoordinates[cityName] && !seenPlaces.has(cityName)) {
          seenPlaces.add(cityName);
          currentCity = cityName;
          places.push({ 
            name: cityName.charAt(0).toUpperCase() + cityName.slice(1), 
            order: order++,
            type: 'city'
          });
        }
      }
    }

    // Second pass: Extract landmarks and places from bullet points
    // Look for bold text which usually indicates specific places
    for (const line of lines) {
      // Extract bold place names like **Fushimi Inari Shrine** or **Senso-ji Temple**
      const boldMatches = line.match(/\*\*([^*]+)\*\*/g);
      if (boldMatches) {
        for (const match of boldMatches) {
          const placeName = match.replace(/\*\*/g, '').trim();
          const placeKey = placeName.toLowerCase();
          
          // Skip if already seen or if it's a time/generic word
          if (seenPlaces.has(placeKey)) continue;
          if (/^(morning|afternoon|evening|night|day \d+|getting there|meals|logistics|budget|notes)/i.test(placeName)) continue;
          if (placeName.length < 4 || placeName.length > 60) continue;
          
          // Check if it looks like a place name (contains place keywords or is capitalized properly)
          const isLikelyPlace = /temple|shrine|palace|castle|museum|park|garden|market|tower|bridge|station|district|square|beach|mountain|falls|waterfall|cathedral|church|mosque|gate|street|road|avenue|restaurant|cafe|bar|hotel|resort/i.test(placeName) ||
            (placeName.split(' ').length >= 2 && /^[A-Z]/.test(placeName));
          
          if (isLikelyPlace) {
            seenPlaces.add(placeKey);
            places.push({
              name: placeName,
              order: order++,
              type: 'landmark'
            });
          }
        }
      }

      // Also extract from markdown links [Place Name](url)
      const linkMatches = line.match(/\[([^\]]+)\]\([^)]+\)/g);
      if (linkMatches) {
        for (const match of linkMatches) {
          const linkTextMatch = match.match(/\[([^\]]+)\]/);
          if (linkTextMatch) {
            const placeName = linkTextMatch[1].trim();
            const placeKey = placeName.toLowerCase();
            
            if (seenPlaces.has(placeKey)) continue;
            if (placeName.length < 4 || placeName.length > 60) continue;
            if (/^(book|click|here|link|website|more|view)/i.test(placeName)) continue;
            
            seenPlaces.add(placeKey);
            places.push({
              name: placeName,
              order: order++,
              type: 'place'
            });
          }
        }
      }
    }

    // Also check for known cities in route format
    const knownCityNames = Object.keys(cityCoordinates);
    for (const city of knownCityNames) {
      const regex = new RegExp(`\\*?\\*?${city}\\*?\\*?\\s*\\(\\d+`, 'i');
      if (regex.test(itinerary) && !seenPlaces.has(city)) {
        seenPlaces.add(city);
        places.push({ 
          name: city.charAt(0).toUpperCase() + city.slice(1), 
          order: order++,
          type: 'city'
        });
      }
    }

    // Limit to reasonable number of locations
    return places.slice(0, 25);
  }, [itinerary]);

  // Geocode locations
  useEffect(() => {
    const geocodeLocations = async () => {
      setIsLoading(true);
      const geocoded: Location[] = [];
      const geocodeQueue: typeof extractedLocations = [];

      // First add known cities directly
      for (const place of extractedLocations) {
        const placeLower = place.name.toLowerCase();
        const coords = cityCoordinates[placeLower];
        
        if (coords) {
          geocoded.push({
            name: place.name,
            lat: coords.lat,
            lng: coords.lng,
            order: place.order,
            type: place.type
          });
        } else {
          geocodeQueue.push(place);
        }
      }

      // Then geocode unknown places (limit to avoid rate limiting)
      const toGeocode = geocodeQueue.slice(0, 15);
      for (const place of toGeocode) {
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
              order: place.order,
              type: place.type
            });
          }
          await new Promise(r => setTimeout(r, 250)); // Rate limit
        } catch (error) {
          console.warn(`Failed to geocode: ${place.name}`);
        }
      }

      // Sort by order
      geocoded.sort((a, b) => a.order - b.order);
      setLocations(geocoded);
      setIsLoading(false);
    };

    if (extractedLocations.length > 0) {
      geocodeLocations();
    } else {
      setLocations([]);
      setIsLoading(false);
    }
  }, [extractedLocations]);

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

    // Create custom marker icon based on type
    const createMarkerIcon = (order: number, name: string, type: 'city' | 'landmark' | 'place') => {
      const bgColor = type === 'city' ? '#C45D35' : type === 'landmark' ? '#6366f1' : '#10b981';
      const size = type === 'city' ? 32 : 24;
      const fontSize = type === 'city' ? 14 : 11;
      
      return L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="display: flex; flex-direction: column; align-items: center; transform: translateX(-50%);">
            <div style="
              background: ${bgColor};
              width: ${size}px;
              height: ${size}px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: bold;
              font-size: ${fontSize}px;
              border: 2px solid white;
              box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            ">${order}</div>
            <div style="
              background: white;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: ${type === 'city' ? 12 : 10}px;
              font-weight: ${type === 'city' ? 600 : 500};
              color: #1a1a1a;
              white-space: nowrap;
              box-shadow: 0 1px 4px rgba(0,0,0,0.2);
              margin-top: 3px;
              max-width: 140px;
              overflow: hidden;
              text-overflow: ellipsis;
            ">${name}</div>
          </div>
        `,
        iconSize: [140, 60],
        iconAnchor: [70, 16],
      });
    };

    // Add markers
    const bounds = L.latLngBounds([]);
    locations.forEach((location) => {
      const marker = L.marker([location.lat, location.lng], {
        icon: createMarkerIcon(location.order, location.name, location.type),
      }).addTo(map);

      const typeLabel = location.type === 'city' ? 'City' : location.type === 'landmark' ? 'Landmark' : 'Place';
      marker.bindPopup(`
        <div style="font-weight: 600;">${location.name}</div>
        <div style="font-size: 12px; color: #666;">Stop ${location.order} • ${typeLabel}</div>
      `);

      bounds.extend([location.lat, location.lng]);
    });

    // Add route line connecting all points
    if (locations.length > 1) {
      const latLngs: L.LatLngExpression[] = locations.map(loc => [loc.lat, loc.lng] as L.LatLngTuple);
      L.polyline(latLngs, {
        color: '#C45D35',
        weight: 2,
        opacity: 0.6,
        dashArray: '8, 8',
      }).addTo(map);
    }

    // Fit bounds
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [60, 60] });
    }

    // Cleanup on unmount
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [locations]);

  if (isLoading && extractedLocations.length > 0) {
    return (
      <div className="h-[400px] rounded-xl bg-muted flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Finding {extractedLocations.length} locations...</p>
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="h-[300px] rounded-xl bg-muted flex items-center justify-center">
        <div className="text-center space-y-2">
          <MapPin className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No locations found to map</p>
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
