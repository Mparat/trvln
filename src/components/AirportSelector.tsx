import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  isAllAirports?: boolean;
}

// Major cities with multiple airports - "All Airports" options
const allAirportsOptions: Airport[] = [
  { code: "NYC", name: "All New York Airports", city: "New York", country: "USA", isAllAirports: true },
  { code: "LON", name: "All London Airports", city: "London", country: "UK", isAllAirports: true },
  { code: "PAR", name: "All Paris Airports", city: "Paris", country: "France", isAllAirports: true },
  { code: "TYO", name: "All Tokyo Airports", city: "Tokyo", country: "Japan", isAllAirports: true },
  { code: "CHI", name: "All Chicago Airports", city: "Chicago", country: "USA", isAllAirports: true },
  { code: "WAS", name: "All Washington DC Airports", city: "Washington DC", country: "USA", isAllAirports: true },
  { code: "SFB", name: "All San Francisco Bay Airports", city: "San Francisco", country: "USA", isAllAirports: true },
  { code: "MIL", name: "All Milan Airports", city: "Milan", country: "Italy", isAllAirports: true },
  { code: "SEL", name: "All Seoul Airports", city: "Seoul", country: "South Korea", isAllAirports: true },
  { code: "SHA", name: "All Shanghai Airports", city: "Shanghai", country: "China", isAllAirports: true },
  { code: "BJS", name: "All Beijing Airports", city: "Beijing", country: "China", isAllAirports: true },
  { code: "BKK", name: "All Bangkok Airports", city: "Bangkok", country: "Thailand", isAllAirports: true },
  { code: "IST", name: "All Istanbul Airports", city: "Istanbul", country: "Turkey", isAllAirports: true },
  { code: "DFW", name: "All Dallas Airports", city: "Dallas", country: "USA", isAllAirports: true },
  { code: "HOU", name: "All Houston Airports", city: "Houston", country: "USA", isAllAirports: true },
  { code: "MIA", name: "All Miami/Ft. Lauderdale Airports", city: "Miami", country: "USA", isAllAirports: true },
];

// Comprehensive list of major world airports
const airports: Airport[] = [
  // United States
  { code: "JFK", name: "John F. Kennedy International", city: "New York", country: "USA" },
  { code: "LGA", name: "LaGuardia", city: "New York", country: "USA" },
  { code: "EWR", name: "Newark Liberty International", city: "Newark", country: "USA" },
  { code: "LAX", name: "Los Angeles International", city: "Los Angeles", country: "USA" },
  { code: "SFO", name: "San Francisco International", city: "San Francisco", country: "USA" },
  { code: "OAK", name: "Oakland International", city: "Oakland", country: "USA" },
  { code: "SJC", name: "San Jose International", city: "San Jose", country: "USA" },
  { code: "ORD", name: "O'Hare International", city: "Chicago", country: "USA" },
  { code: "MDW", name: "Midway International", city: "Chicago", country: "USA" },
  { code: "ATL", name: "Hartsfield-Jackson International", city: "Atlanta", country: "USA" },
  { code: "DFW", name: "Dallas/Fort Worth International", city: "Dallas", country: "USA" },
  { code: "DAL", name: "Dallas Love Field", city: "Dallas", country: "USA" },
  { code: "DEN", name: "Denver International", city: "Denver", country: "USA" },
  { code: "SEA", name: "Seattle-Tacoma International", city: "Seattle", country: "USA" },
  { code: "BOS", name: "Logan International", city: "Boston", country: "USA" },
  { code: "MIA", name: "Miami International", city: "Miami", country: "USA" },
  { code: "FLL", name: "Fort Lauderdale-Hollywood", city: "Fort Lauderdale", country: "USA" },
  { code: "PHL", name: "Philadelphia International", city: "Philadelphia", country: "USA" },
  { code: "DCA", name: "Reagan National", city: "Washington DC", country: "USA" },
  { code: "IAD", name: "Dulles International", city: "Washington DC", country: "USA" },
  { code: "BWI", name: "Baltimore-Washington", city: "Baltimore", country: "USA" },
  { code: "PHX", name: "Phoenix Sky Harbor", city: "Phoenix", country: "USA" },
  { code: "IAH", name: "George Bush Intercontinental", city: "Houston", country: "USA" },
  { code: "HOU", name: "William P. Hobby", city: "Houston", country: "USA" },
  { code: "MSP", name: "Minneapolis-Saint Paul", city: "Minneapolis", country: "USA" },
  { code: "DTW", name: "Detroit Metropolitan", city: "Detroit", country: "USA" },
  { code: "MCO", name: "Orlando International", city: "Orlando", country: "USA" },
  { code: "LAS", name: "Harry Reid International", city: "Las Vegas", country: "USA" },
  { code: "SAN", name: "San Diego International", city: "San Diego", country: "USA" },
  { code: "TPA", name: "Tampa International", city: "Tampa", country: "USA" },
  { code: "PDX", name: "Portland International", city: "Portland", country: "USA" },
  { code: "CLT", name: "Charlotte Douglas International", city: "Charlotte", country: "USA" },
  { code: "SLC", name: "Salt Lake City International", city: "Salt Lake City", country: "USA" },
  { code: "AUS", name: "Austin-Bergstrom International", city: "Austin", country: "USA" },
  { code: "BNA", name: "Nashville International", city: "Nashville", country: "USA" },
  { code: "RDU", name: "Raleigh-Durham International", city: "Raleigh", country: "USA" },
  { code: "HNL", name: "Daniel K. Inouye International", city: "Honolulu", country: "USA" },
  { code: "ANC", name: "Ted Stevens Anchorage", city: "Anchorage", country: "USA" },

  // Canada
  { code: "YYZ", name: "Toronto Pearson", city: "Toronto", country: "Canada" },
  { code: "YVR", name: "Vancouver International", city: "Vancouver", country: "Canada" },
  { code: "YUL", name: "Montréal-Trudeau", city: "Montreal", country: "Canada" },
  { code: "YYC", name: "Calgary International", city: "Calgary", country: "Canada" },
  { code: "YOW", name: "Ottawa Macdonald-Cartier", city: "Ottawa", country: "Canada" },

  // United Kingdom
  { code: "LHR", name: "Heathrow", city: "London", country: "UK" },
  { code: "LGW", name: "Gatwick", city: "London", country: "UK" },
  { code: "STN", name: "Stansted", city: "London", country: "UK" },
  { code: "LTN", name: "Luton", city: "London", country: "UK" },
  { code: "MAN", name: "Manchester", city: "Manchester", country: "UK" },
  { code: "EDI", name: "Edinburgh", city: "Edinburgh", country: "UK" },
  { code: "BHX", name: "Birmingham", city: "Birmingham", country: "UK" },

  // Europe
  { code: "CDG", name: "Charles de Gaulle", city: "Paris", country: "France" },
  { code: "ORY", name: "Orly", city: "Paris", country: "France" },
  { code: "FRA", name: "Frankfurt", city: "Frankfurt", country: "Germany" },
  { code: "MUC", name: "Munich", city: "Munich", country: "Germany" },
  { code: "BER", name: "Berlin Brandenburg", city: "Berlin", country: "Germany" },
  { code: "AMS", name: "Schiphol", city: "Amsterdam", country: "Netherlands" },
  { code: "MAD", name: "Adolfo Suárez Madrid-Barajas", city: "Madrid", country: "Spain" },
  { code: "BCN", name: "El Prat", city: "Barcelona", country: "Spain" },
  { code: "FCO", name: "Leonardo da Vinci-Fiumicino", city: "Rome", country: "Italy" },
  { code: "MXP", name: "Malpensa", city: "Milan", country: "Italy" },
  { code: "VCE", name: "Marco Polo", city: "Venice", country: "Italy" },
  { code: "ZRH", name: "Zurich", city: "Zurich", country: "Switzerland" },
  { code: "GVA", name: "Geneva", city: "Geneva", country: "Switzerland" },
  { code: "VIE", name: "Vienna International", city: "Vienna", country: "Austria" },
  { code: "BRU", name: "Brussels", city: "Brussels", country: "Belgium" },
  { code: "CPH", name: "Copenhagen", city: "Copenhagen", country: "Denmark" },
  { code: "OSL", name: "Oslo Gardermoen", city: "Oslo", country: "Norway" },
  { code: "ARN", name: "Stockholm Arlanda", city: "Stockholm", country: "Sweden" },
  { code: "HEL", name: "Helsinki-Vantaa", city: "Helsinki", country: "Finland" },
  { code: "LIS", name: "Lisbon Portela", city: "Lisbon", country: "Portugal" },
  { code: "DUB", name: "Dublin", city: "Dublin", country: "Ireland" },
  { code: "ATH", name: "Athens International", city: "Athens", country: "Greece" },
  { code: "PRG", name: "Václav Havel Prague", city: "Prague", country: "Czech Republic" },
  { code: "WAW", name: "Warsaw Chopin", city: "Warsaw", country: "Poland" },
  { code: "BUD", name: "Budapest Ferenc Liszt", city: "Budapest", country: "Hungary" },
  { code: "IST", name: "Istanbul", city: "Istanbul", country: "Turkey" },
  { code: "SAW", name: "Sabiha Gökçen", city: "Istanbul", country: "Turkey" },

  // Asia
  { code: "NRT", name: "Narita International", city: "Tokyo", country: "Japan" },
  { code: "HND", name: "Haneda", city: "Tokyo", country: "Japan" },
  { code: "KIX", name: "Kansai International", city: "Osaka", country: "Japan" },
  { code: "ICN", name: "Incheon International", city: "Seoul", country: "South Korea" },
  { code: "GMP", name: "Gimpo International", city: "Seoul", country: "South Korea" },
  { code: "PEK", name: "Beijing Capital", city: "Beijing", country: "China" },
  { code: "PKX", name: "Beijing Daxing", city: "Beijing", country: "China" },
  { code: "PVG", name: "Shanghai Pudong", city: "Shanghai", country: "China" },
  { code: "SHA", name: "Shanghai Hongqiao", city: "Shanghai", country: "China" },
  { code: "CAN", name: "Guangzhou Baiyun", city: "Guangzhou", country: "China" },
  { code: "HKG", name: "Hong Kong International", city: "Hong Kong", country: "Hong Kong" },
  { code: "TPE", name: "Taiwan Taoyuan", city: "Taipei", country: "Taiwan" },
  { code: "SIN", name: "Changi", city: "Singapore", country: "Singapore" },
  { code: "BKK", name: "Suvarnabhumi", city: "Bangkok", country: "Thailand" },
  { code: "DMK", name: "Don Mueang", city: "Bangkok", country: "Thailand" },
  { code: "KUL", name: "Kuala Lumpur International", city: "Kuala Lumpur", country: "Malaysia" },
  { code: "CGK", name: "Soekarno-Hatta", city: "Jakarta", country: "Indonesia" },
  { code: "DPS", name: "Ngurah Rai", city: "Bali", country: "Indonesia" },
  { code: "MNL", name: "Ninoy Aquino", city: "Manila", country: "Philippines" },
  { code: "SGN", name: "Tan Son Nhat", city: "Ho Chi Minh City", country: "Vietnam" },
  { code: "HAN", name: "Noi Bai", city: "Hanoi", country: "Vietnam" },
  { code: "DEL", name: "Indira Gandhi International", city: "Delhi", country: "India" },
  { code: "BOM", name: "Chhatrapati Shivaji Maharaj", city: "Mumbai", country: "India" },
  { code: "BLR", name: "Kempegowda International", city: "Bangalore", country: "India" },
  { code: "MAA", name: "Chennai International", city: "Chennai", country: "India" },

  // Middle East
  { code: "DXB", name: "Dubai International", city: "Dubai", country: "UAE" },
  { code: "AUH", name: "Abu Dhabi International", city: "Abu Dhabi", country: "UAE" },
  { code: "DOH", name: "Hamad International", city: "Doha", country: "Qatar" },
  { code: "TLV", name: "Ben Gurion", city: "Tel Aviv", country: "Israel" },
  { code: "AMM", name: "Queen Alia", city: "Amman", country: "Jordan" },
  { code: "CAI", name: "Cairo International", city: "Cairo", country: "Egypt" },
  { code: "JED", name: "King Abdulaziz", city: "Jeddah", country: "Saudi Arabia" },
  { code: "RUH", name: "King Khalid", city: "Riyadh", country: "Saudi Arabia" },

  // Oceania
  { code: "SYD", name: "Sydney Kingsford Smith", city: "Sydney", country: "Australia" },
  { code: "MEL", name: "Melbourne Tullamarine", city: "Melbourne", country: "Australia" },
  { code: "BNE", name: "Brisbane", city: "Brisbane", country: "Australia" },
  { code: "PER", name: "Perth", city: "Perth", country: "Australia" },
  { code: "AKL", name: "Auckland", city: "Auckland", country: "New Zealand" },
  { code: "WLG", name: "Wellington", city: "Wellington", country: "New Zealand" },
  { code: "CHC", name: "Christchurch", city: "Christchurch", country: "New Zealand" },

  // Latin America
  { code: "MEX", name: "Benito Juárez", city: "Mexico City", country: "Mexico" },
  { code: "CUN", name: "Cancún International", city: "Cancún", country: "Mexico" },
  { code: "GDL", name: "Miguel Hidalgo y Costilla", city: "Guadalajara", country: "Mexico" },
  { code: "MTY", name: "Monterrey International", city: "Monterrey", country: "Mexico" },
  { code: "TIJ", name: "Tijuana International", city: "Tijuana", country: "Mexico" },
  { code: "SJD", name: "Los Cabos International", city: "San José del Cabo", country: "Mexico" },
  { code: "PVR", name: "Licenciado Gustavo Díaz Ordaz", city: "Puerto Vallarta", country: "Mexico" },
  { code: "GRU", name: "São Paulo-Guarulhos", city: "São Paulo", country: "Brazil" },
  { code: "GIG", name: "Rio de Janeiro-Galeão", city: "Rio de Janeiro", country: "Brazil" },
  { code: "BSB", name: "Presidente Juscelino Kubitschek", city: "Brasília", country: "Brazil" },
  { code: "CNF", name: "Tancredo Neves International", city: "Belo Horizonte", country: "Brazil" },
  { code: "SSA", name: "Deputado Luís Eduardo Magalhães", city: "Salvador", country: "Brazil" },
  { code: "REC", name: "Recife/Guararapes", city: "Recife", country: "Brazil" },
  { code: "FOR", name: "Pinto Martins", city: "Fortaleza", country: "Brazil" },
  { code: "POA", name: "Salgado Filho", city: "Porto Alegre", country: "Brazil" },
  { code: "CWB", name: "Afonso Pena", city: "Curitiba", country: "Brazil" },
  { code: "EZE", name: "Ministro Pistarini", city: "Buenos Aires", country: "Argentina" },
  { code: "AEP", name: "Jorge Newbery Aeroparque", city: "Buenos Aires", country: "Argentina" },
  { code: "COR", name: "Ingeniero Aeronáutico Ambrosio L.V. Taravella", city: "Córdoba", country: "Argentina" },
  { code: "MDZ", name: "El Plumerillo", city: "Mendoza", country: "Argentina" },
  { code: "SCL", name: "Arturo Merino Benítez", city: "Santiago", country: "Chile" },
  { code: "BOG", name: "El Dorado", city: "Bogotá", country: "Colombia" },
  { code: "MDE", name: "José María Córdova", city: "Medellín", country: "Colombia" },
  { code: "CTG", name: "Rafael Núñez", city: "Cartagena", country: "Colombia" },
  { code: "CLO", name: "Alfonso Bonilla Aragón", city: "Cali", country: "Colombia" },
  { code: "BAQ", name: "Ernesto Cortissoz", city: "Barranquilla", country: "Colombia" },
  { code: "LIM", name: "Jorge Chávez", city: "Lima", country: "Peru" },
  { code: "CUZ", name: "Alejandro Velasco Astete", city: "Cusco", country: "Peru" },
  { code: "UIO", name: "Mariscal Sucre", city: "Quito", country: "Ecuador" },
  { code: "GYE", name: "José Joaquín de Olmedo", city: "Guayaquil", country: "Ecuador" },
  { code: "CCS", name: "Simón Bolívar", city: "Caracas", country: "Venezuela" },
  { code: "LPB", name: "El Alto International", city: "La Paz", country: "Bolivia" },
  { code: "VVI", name: "Viru Viru", city: "Santa Cruz", country: "Bolivia" },
  { code: "ASU", name: "Silvio Pettirossi", city: "Asunción", country: "Paraguay" },
  { code: "MVD", name: "Carrasco International", city: "Montevideo", country: "Uruguay" },
  { code: "PTY", name: "Tocumen", city: "Panama City", country: "Panama" },
  { code: "SJO", name: "Juan Santamaría", city: "San José", country: "Costa Rica" },
  { code: "LIR", name: "Daniel Oduber Quirós", city: "Liberia", country: "Costa Rica" },
  { code: "GUA", name: "La Aurora", city: "Guatemala City", country: "Guatemala" },
  { code: "SAL", name: "Monseñor Óscar Arnulfo Romero", city: "San Salvador", country: "El Salvador" },
  { code: "TGU", name: "Toncontín", city: "Tegucigalpa", country: "Honduras" },
  { code: "SAP", name: "Ramón Villeda Morales", city: "San Pedro Sula", country: "Honduras" },
  { code: "MGA", name: "Augusto C. Sandino", city: "Managua", country: "Nicaragua" },
  { code: "BZE", name: "Philip S.W. Goldson", city: "Belize City", country: "Belize" },
  { code: "HAV", name: "José Martí", city: "Havana", country: "Cuba" },

  // Caribbean
  { code: "SJU", name: "Luis Muñoz Marín", city: "San Juan", country: "Puerto Rico" },
  { code: "NAS", name: "Lynden Pindling", city: "Nassau", country: "Bahamas" },
  { code: "MBJ", name: "Sangster International", city: "Montego Bay", country: "Jamaica" },
  { code: "KIN", name: "Norman Manley", city: "Kingston", country: "Jamaica" },
  { code: "PUJ", name: "Punta Cana", city: "Punta Cana", country: "Dominican Republic" },
  { code: "SDQ", name: "Las Américas", city: "Santo Domingo", country: "Dominican Republic" },
  { code: "AUA", name: "Queen Beatrix", city: "Oranjestad", country: "Aruba" },
  { code: "CUR", name: "Hato International", city: "Willemstad", country: "Curaçao" },
  { code: "SXM", name: "Princess Juliana", city: "Philipsburg", country: "Sint Maarten" },
  { code: "BGI", name: "Grantley Adams", city: "Bridgetown", country: "Barbados" },
  { code: "POS", name: "Piarco International", city: "Port of Spain", country: "Trinidad" },
  { code: "GCM", name: "Owen Roberts", city: "George Town", country: "Cayman Islands" },
  { code: "STT", name: "Cyril E. King", city: "Charlotte Amalie", country: "US Virgin Islands" },
  { code: "SAN", name: "San Diego International", city: "San Diego", country: "USA" },

  // Africa
  { code: "JNB", name: "O.R. Tambo", city: "Johannesburg", country: "South Africa" },
  { code: "CPT", name: "Cape Town International", city: "Cape Town", country: "South Africa" },
  { code: "DUR", name: "King Shaka", city: "Durban", country: "South Africa" },
  { code: "NBO", name: "Jomo Kenyatta", city: "Nairobi", country: "Kenya" },
  { code: "MBA", name: "Moi International", city: "Mombasa", country: "Kenya" },
  { code: "ADD", name: "Bole International", city: "Addis Ababa", country: "Ethiopia" },
  { code: "CMN", name: "Mohammed V", city: "Casablanca", country: "Morocco" },
  { code: "RAK", name: "Marrakech Menara", city: "Marrakech", country: "Morocco" },
  { code: "TNG", name: "Ibn Battouta", city: "Tangier", country: "Morocco" },
  { code: "LOS", name: "Murtala Muhammed", city: "Lagos", country: "Nigeria" },
  { code: "ABV", name: "Nnamdi Azikiwe", city: "Abuja", country: "Nigeria" },
  { code: "ACC", name: "Kotoka International", city: "Accra", country: "Ghana" },
  { code: "DSS", name: "Blaise Diagne", city: "Dakar", country: "Senegal" },
  { code: "TUN", name: "Tunis–Carthage", city: "Tunis", country: "Tunisia" },
  { code: "ALG", name: "Houari Boumediene", city: "Algiers", country: "Algeria" },
  { code: "DAR", name: "Julius Nyerere", city: "Dar es Salaam", country: "Tanzania" },
  { code: "JRO", name: "Kilimanjaro International", city: "Arusha", country: "Tanzania" },
  { code: "ZNZ", name: "Abeid Amani Karume", city: "Zanzibar", country: "Tanzania" },
  { code: "EBB", name: "Entebbe International", city: "Entebbe", country: "Uganda" },
  { code: "KGL", name: "Kigali International", city: "Kigali", country: "Rwanda" },
  { code: "MRU", name: "Sir Seewoosagur Ramgoolam", city: "Mauritius", country: "Mauritius" },
  { code: "SEZ", name: "Seychelles International", city: "Mahé", country: "Seychelles" },
  { code: "WDH", name: "Hosea Kutako", city: "Windhoek", country: "Namibia" },
  { code: "VFA", name: "Victoria Falls", city: "Victoria Falls", country: "Zimbabwe" },
  { code: "HRE", name: "Robert Gabriel Mugabe", city: "Harare", country: "Zimbabwe" },
  { code: "LUN", name: "Kenneth Kaunda", city: "Lusaka", country: "Zambia" },
  { code: "GBE", name: "Sir Seretse Khama", city: "Gaborone", country: "Botswana" },
  { code: "MPM", name: "Maputo International", city: "Maputo", country: "Mozambique" },

  // Balkans & Eastern Europe
  { code: "TGD", name: "Podgorica", city: "Podgorica", country: "Montenegro" },
  { code: "TIV", name: "Tivat", city: "Tivat", country: "Montenegro" },
  { code: "DBV", name: "Dubrovnik", city: "Dubrovnik", country: "Croatia" },
  { code: "SPU", name: "Split", city: "Split", country: "Croatia" },
  { code: "ZAG", name: "Franjo Tuđman", city: "Zagreb", country: "Croatia" },
  { code: "BEG", name: "Nikola Tesla", city: "Belgrade", country: "Serbia" },
  { code: "SJJ", name: "Sarajevo", city: "Sarajevo", country: "Bosnia" },
  { code: "SOF", name: "Sofia", city: "Sofia", country: "Bulgaria" },
  { code: "OTP", name: "Henri Coandă", city: "Bucharest", country: "Romania" },
  { code: "LJU", name: "Jože Pučnik Ljubljana", city: "Ljubljana", country: "Slovenia" },
  { code: "SKP", name: "Skopje International", city: "Skopje", country: "North Macedonia" },
  { code: "TIA", name: "Tirana International", city: "Tirana", country: "Albania" },
];

interface AirportSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function AirportSelector({ value, onChange }: AirportSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const allOptions = [...allAirportsOptions, ...airports];
  const selectedAirport = allOptions.find((airport) => airport.code === value);

  const filteredAirports = useMemo(() => {
    const query = searchQuery.toLowerCase();
    
    // Filter all airports options
    const matchingAllAirports = allAirportsOptions.filter(
      (airport) =>
        airport.city.toLowerCase().includes(query) ||
        airport.name.toLowerCase().includes(query) ||
        airport.code.toLowerCase().includes(query)
    );
    
    // Filter individual airports
    const matchingAirports = airports.filter(
      (airport) =>
        airport.code.toLowerCase().includes(query) ||
        airport.name.toLowerCase().includes(query) ||
        airport.city.toLowerCase().includes(query) ||
        airport.country.toLowerCase().includes(query)
    );
    
    if (!searchQuery) {
      // Show all airports options first, then individual airports
      return [...allAirportsOptions.slice(0, 10), ...airports.slice(0, 40)];
    }
    
    return [...matchingAllAirports, ...matchingAirports].slice(0, 50);
  }, [searchQuery]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between bg-background"
        >
          {selectedAirport ? (
            <span className="flex items-center gap-2 truncate">
              <span className="font-semibold">{selectedAirport.code}</span>
              <span className="text-muted-foreground truncate">
                {selectedAirport.city}, {selectedAirport.country}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Search airports...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search by city, airport, or code..." 
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No airport found.</CommandEmpty>
            <CommandGroup>
              {filteredAirports.map((airport) => (
                <CommandItem
                  key={airport.code}
                  value={airport.code}
                  onSelect={(currentValue) => {
                    onChange(currentValue.toUpperCase());
                    setOpen(false);
                    setSearchQuery("");
                  }}
                  className={cn(
                    "flex items-center gap-2",
                    airport.isAllAirports && "bg-primary/5 border-l-2 border-primary"
                  )}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === airport.code ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <Plane className={cn(
                    "h-4 w-4",
                    airport.isAllAirports ? "text-primary" : "text-muted-foreground"
                  )} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{airport.code}</span>
                      <span className={cn(
                        "text-sm truncate",
                        airport.isAllAirports ? "text-primary font-medium" : "text-muted-foreground"
                      )}>
                        {airport.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {airport.city}, {airport.country}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
