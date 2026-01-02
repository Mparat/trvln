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

interface ExtractedPlace {
  name: string;
  order: number;
  type: 'city' | 'landmark' | 'place';
  cityContext?: string;
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

// Known cities with coordinates
const cityCoordinates: Record<string, { lat: number; lng: number }> = {
  'tokyo': { lat: 35.6762, lng: 139.6503 },
  'kyoto': { lat: 35.0116, lng: 135.7681 },
  'osaka': { lat: 34.6937, lng: 135.5023 },
  'nara': { lat: 34.6851, lng: 135.8050 },
  'hakone': { lat: 35.2324, lng: 139.1069 },
  'hiroshima': { lat: 34.3853, lng: 132.4553 },
  'nagoya': { lat: 35.1815, lng: 136.9066 },
  'fukuoka': { lat: 33.5904, lng: 130.4017 },
  'sapporo': { lat: 43.0618, lng: 141.3545 },
  'nikko': { lat: 36.7199, lng: 139.6982 },
  'kanazawa': { lat: 36.5613, lng: 136.6562 },
  'takayama': { lat: 36.1461, lng: 137.2522 },
  'new york': { lat: 40.7128, lng: -74.0060 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'paris': { lat: 48.8566, lng: 2.3522 },
  'rome': { lat: 41.9028, lng: 12.4964 },
  'barcelona': { lat: 41.3851, lng: 2.1734 },
  'amsterdam': { lat: 52.3676, lng: 4.9041 },
  'berlin': { lat: 52.5200, lng: 13.4050 },
  'singapore': { lat: 1.3521, lng: 103.8198 },
  'hong kong': { lat: 22.3193, lng: 114.1694 },
  'bangkok': { lat: 13.7563, lng: 100.5018 },
  'seoul': { lat: 37.5665, lng: 126.9780 },
  'sydney': { lat: -33.8688, lng: 151.2093 },
  'dubai': { lat: 25.2048, lng: 55.2708 },
  'istanbul': { lat: 41.0082, lng: 28.9784 },
  'lisbon': { lat: 38.7223, lng: -9.1393 },
  'madrid': { lat: 40.4168, lng: -3.7038 },
  'vienna': { lat: 48.2082, lng: 16.3738 },
  'prague': { lat: 50.0755, lng: 14.4378 },
  'budapest': { lat: 47.4979, lng: 19.0402 },
  'athens': { lat: 37.9838, lng: 23.7275 },
  'copenhagen': { lat: 55.6761, lng: 12.5683 },
  'stockholm': { lat: 59.3293, lng: 18.0686 },
};

// Known landmarks with precise coordinates
const landmarkCoordinates: Record<string, { lat: number; lng: number }> = {
  // Tokyo landmarks
  'senso-ji temple': { lat: 35.7148, lng: 139.7967 },
  'sensoji temple': { lat: 35.7148, lng: 139.7967 },
  'senso-ji': { lat: 35.7148, lng: 139.7967 },
  'meiji shrine': { lat: 35.6764, lng: 139.6993 },
  'meiji jingu': { lat: 35.6764, lng: 139.6993 },
  'shibuya crossing': { lat: 35.6595, lng: 139.7004 },
  'shibuya': { lat: 35.6595, lng: 139.7004 },
  'shinjuku': { lat: 35.6938, lng: 139.7034 },
  'shinjuku gyoen': { lat: 35.6852, lng: 139.7100 },
  'tokyo skytree': { lat: 35.7101, lng: 139.8107 },
  'tokyo tower': { lat: 35.6586, lng: 139.7454 },
  'imperial palace': { lat: 35.6852, lng: 139.7528 },
  'tsukiji market': { lat: 35.6654, lng: 139.7707 },
  'tsukiji outer market': { lat: 35.6654, lng: 139.7707 },
  'toyosu market': { lat: 35.6457, lng: 139.7810 },
  'harajuku': { lat: 35.6702, lng: 139.7026 },
  'takeshita street': { lat: 35.6716, lng: 139.7030 },
  'akihabara': { lat: 35.7023, lng: 139.7745 },
  'ueno park': { lat: 35.7146, lng: 139.7732 },
  'ginza': { lat: 35.6717, lng: 139.7649 },
  'roppongi': { lat: 35.6628, lng: 139.7315 },
  'odaiba': { lat: 35.6295, lng: 139.7756 },
  'asakusa': { lat: 35.7116, lng: 139.7966 },
  'teamlab borderless': { lat: 35.6267, lng: 139.7839 },
  'teamlab planets': { lat: 35.6500, lng: 139.7900 },
  
  // Kyoto landmarks
  'fushimi inari shrine': { lat: 34.9671, lng: 135.7727 },
  'fushimi inari taisha': { lat: 34.9671, lng: 135.7727 },
  'fushimi inari': { lat: 34.9671, lng: 135.7727 },
  'kinkaku-ji': { lat: 35.0394, lng: 135.7292 },
  'kinkakuji': { lat: 35.0394, lng: 135.7292 },
  'golden pavilion': { lat: 35.0394, lng: 135.7292 },
  'ginkaku-ji': { lat: 35.0270, lng: 135.7982 },
  'silver pavilion': { lat: 35.0270, lng: 135.7982 },
  'arashiyama': { lat: 35.0094, lng: 135.6737 },
  'arashiyama bamboo grove': { lat: 35.0168, lng: 135.6713 },
  'bamboo grove': { lat: 35.0168, lng: 135.6713 },
  'kiyomizu-dera': { lat: 34.9949, lng: 135.7850 },
  'kiyomizudera': { lat: 34.9949, lng: 135.7850 },
  'kiyomizu temple': { lat: 34.9949, lng: 135.7850 },
  'gion': { lat: 35.0037, lng: 135.7756 },
  'gion district': { lat: 35.0037, lng: 135.7756 },
  'nijo castle': { lat: 35.0142, lng: 135.7480 },
  'philosopher\'s path': { lat: 35.0270, lng: 135.7940 },
  'nishiki market': { lat: 35.0050, lng: 135.7648 },
  'ryoan-ji': { lat: 35.0345, lng: 135.7182 },
  'higashiyama': { lat: 34.9985, lng: 135.7810 },
  
  // Osaka landmarks
  'osaka castle': { lat: 34.6873, lng: 135.5262 },
  'dotonbori': { lat: 34.6687, lng: 135.5030 },
  'shinsekai': { lat: 34.6519, lng: 135.5063 },
  'kuromon market': { lat: 34.6661, lng: 135.5064 },
  'universal studios japan': { lat: 34.6654, lng: 135.4323 },
  'umeda sky building': { lat: 34.7052, lng: 135.4906 },
  'shitennoji temple': { lat: 34.6534, lng: 135.5167 },
  
  // Nara landmarks
  'todai-ji': { lat: 34.6890, lng: 135.8398 },
  'todaiji': { lat: 34.6890, lng: 135.8398 },
  'nara park': { lat: 34.6851, lng: 135.8430 },
  'kasuga taisha': { lat: 34.6812, lng: 135.8495 },
  'isuien garden': { lat: 34.6876, lng: 135.8420 },
  
  // Other Japan landmarks
  'mount fuji': { lat: 35.3606, lng: 138.7274 },
  'mt fuji': { lat: 35.3606, lng: 138.7274 },
  'lake kawaguchi': { lat: 35.5161, lng: 138.7513 },
  'hakone shrine': { lat: 35.1964, lng: 139.0235 },
  'lake ashi': { lat: 35.2066, lng: 139.0220 },
  'hiroshima peace memorial': { lat: 34.3955, lng: 132.4536 },
  'atomic bomb dome': { lat: 34.3955, lng: 132.4536 },
  'miyajima': { lat: 34.2961, lng: 132.3198 },
  'itsukushima shrine': { lat: 34.2961, lng: 132.3198 },
  
  // Paris landmarks
  'eiffel tower': { lat: 48.8584, lng: 2.2945 },
  'louvre': { lat: 48.8606, lng: 2.3376 },
  'louvre museum': { lat: 48.8606, lng: 2.3376 },
  'notre dame': { lat: 48.8530, lng: 2.3499 },
  'arc de triomphe': { lat: 48.8738, lng: 2.2950 },
  'sacré-cœur': { lat: 48.8867, lng: 2.3431 },
  'montmartre': { lat: 48.8867, lng: 2.3431 },
  'champs-élysées': { lat: 48.8698, lng: 2.3078 },
  'musée d\'orsay': { lat: 48.8600, lng: 2.3266 },
  'palace of versailles': { lat: 48.8049, lng: 2.1204 },
  
  // London landmarks
  'big ben': { lat: 51.5007, lng: -0.1246 },
  'tower of london': { lat: 51.5081, lng: -0.0759 },
  'buckingham palace': { lat: 51.5014, lng: -0.1419 },
  'tower bridge': { lat: 51.5055, lng: -0.0754 },
  'london eye': { lat: 51.5033, lng: -0.1196 },
  'british museum': { lat: 51.5194, lng: -0.1270 },
  'westminster abbey': { lat: 51.4993, lng: -0.1273 },
  'trafalgar square': { lat: 51.5080, lng: -0.1281 },
  
  // New York landmarks
  'statue of liberty': { lat: 40.6892, lng: -74.0445 },
  'central park': { lat: 40.7829, lng: -73.9654 },
  'times square': { lat: 40.7580, lng: -73.9855 },
  'empire state building': { lat: 40.7484, lng: -73.9857 },
  'brooklyn bridge': { lat: 40.7061, lng: -73.9969 },
  'metropolitan museum': { lat: 40.7794, lng: -73.9632 },
  'the met': { lat: 40.7794, lng: -73.9632 },
  'high line': { lat: 40.7480, lng: -74.0048 },
  
  // Rome landmarks
  'colosseum': { lat: 41.8902, lng: 12.4922 },
  'vatican': { lat: 41.9029, lng: 12.4534 },
  'st peter\'s basilica': { lat: 41.9022, lng: 12.4539 },
  'sistine chapel': { lat: 41.9029, lng: 12.4545 },
  'trevi fountain': { lat: 41.9009, lng: 12.4833 },
  'pantheon': { lat: 41.8986, lng: 12.4769 },
  'roman forum': { lat: 41.8925, lng: 12.4853 },
  'spanish steps': { lat: 41.9060, lng: 12.4828 },
};

// Normalize place name for lookup
const normalizePlaceName = (name: string): string => {
  return name.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

export function ItineraryMap({ itinerary }: ItineraryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Extract all key locations from itinerary with city context
  const extractedLocations = useMemo(() => {
    const places: ExtractedPlace[] = [];
    const seenPlaces = new Set<string>();
    const lines = itinerary.split('\n');
    let order = 1;
    let currentCity = '';

    for (const line of lines) {
      // Check for city in Day headers
      const dayMatch = line.match(/Day\s+\d+[:\—–-]\s*\*?\*?([A-Z][a-zA-Z\s]+)\*?\*?/i);
      if (dayMatch) {
        const cityName = dayMatch[1].trim().toLowerCase().replace(/\s*—.*$/, '').replace(/\s*-.*$/, '');
        if (cityCoordinates[cityName]) {
          currentCity = cityName;
          if (!seenPlaces.has(cityName)) {
            seenPlaces.add(cityName);
            places.push({ 
              name: cityName.charAt(0).toUpperCase() + cityName.slice(1), 
              order: order++,
              type: 'city'
            });
          }
        }
      }

      // Extract bold place names like **Fushimi Inari Shrine**
      const boldMatches = line.match(/\*\*([^*]+)\*\*/g);
      if (boldMatches) {
        for (const match of boldMatches) {
          const placeName = match.replace(/\*\*/g, '').trim();
          const placeKey = normalizePlaceName(placeName);
          
          if (seenPlaces.has(placeKey)) continue;
          if (/^(morning|afternoon|evening|night|day \d+|getting there|meals|logistics|budget|notes|tip|pro tip)/i.test(placeName)) continue;
          if (placeName.length < 4 || placeName.length > 60) continue;
          
          // Check if it looks like a place/landmark
          const isLikelyPlace = /temple|shrine|palace|castle|museum|park|garden|market|tower|bridge|station|district|square|beach|mountain|falls|waterfall|cathedral|church|mosque|gate|crossing|building|memorial|dome|pavilion/i.test(placeName) ||
            landmarkCoordinates[placeKey];
          
          if (isLikelyPlace) {
            seenPlaces.add(placeKey);
            places.push({
              name: placeName,
              order: order++,
              type: 'landmark',
              cityContext: currentCity
            });
          }
        }
      }
    }

    // Limit to reasonable number
    return places.slice(0, 20);
  }, [itinerary]);

  // Geocode locations
  useEffect(() => {
    const geocodeLocations = async () => {
      setIsLoading(true);
      const geocoded: Location[] = [];
      const geocodeQueue: ExtractedPlace[] = [];

      // First check known coordinates
      for (const place of extractedLocations) {
        const placeKey = normalizePlaceName(place.name);
        
        // Check landmarks first
        if (landmarkCoordinates[placeKey]) {
          geocoded.push({
            name: place.name,
            lat: landmarkCoordinates[placeKey].lat,
            lng: landmarkCoordinates[placeKey].lng,
            order: place.order,
            type: place.type
          });
          continue;
        }
        
        // Check cities
        if (cityCoordinates[placeKey]) {
          geocoded.push({
            name: place.name,
            lat: cityCoordinates[placeKey].lat,
            lng: cityCoordinates[placeKey].lng,
            order: place.order,
            type: place.type
          });
          continue;
        }

        // Queue for geocoding
        geocodeQueue.push(place);
      }

      // Geocode unknown places with city context for accuracy
      const toGeocode = geocodeQueue.slice(0, 10);
      for (const place of toGeocode) {
        try {
          // Add city context for better accuracy
          const searchQuery = place.cityContext 
            ? `${place.name}, ${place.cityContext}`
            : place.name;
          
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`,
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
          await new Promise(r => setTimeout(r, 300));
        } catch (error) {
          console.warn(`Failed to geocode: ${place.name}`);
        }
      }

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

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      scrollWheelZoom: false,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const createMarkerIcon = (order: number, name: string, type: 'city' | 'landmark' | 'place') => {
      const bgColor = type === 'city' ? '#C45D35' : '#6366f1';
      const size = type === 'city' ? 28 : 22;
      
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
              font-size: ${type === 'city' ? 12 : 10}px;
              border: 2px solid white;
              box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            ">${order}</div>
            <div style="
              background: white;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 500;
              color: #1a1a1a;
              white-space: nowrap;
              box-shadow: 0 1px 4px rgba(0,0,0,0.2);
              margin-top: 2px;
              max-width: 120px;
              overflow: hidden;
              text-overflow: ellipsis;
            ">${name}</div>
          </div>
        `,
        iconSize: [120, 50],
        iconAnchor: [60, 14],
      });
    };

    const bounds = L.latLngBounds([]);
    locations.forEach((location) => {
      const marker = L.marker([location.lat, location.lng], {
        icon: createMarkerIcon(location.order, location.name, location.type),
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-weight: 600;">${location.name}</div>
        <div style="font-size: 12px; color: #666;">Stop ${location.order}</div>
      `);

      bounds.extend([location.lat, location.lng]);
    });

    if (locations.length > 1) {
      const latLngs: L.LatLngExpression[] = locations.map(loc => [loc.lat, loc.lng] as L.LatLngTuple);
      L.polyline(latLngs, {
        color: '#C45D35',
        weight: 2,
        opacity: 0.5,
        dashArray: '6, 6',
      }).addTo(map);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

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
          <p className="text-sm text-muted-foreground">Mapping {extractedLocations.length} locations...</p>
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
