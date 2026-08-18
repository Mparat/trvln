import type { ItineraryData } from "@/types/itinerary";

// A realistic post-generation itinerary in the current structured format,
// including the fields the edit flow must never lose: sources, bookingUrl on
// an activity, and (in variants below) locked/failed days.
export const makeItinerary = (): ItineraryData => ({
  summary: {
    destination: "Moab, Utah",
    duration: "5 days",
    recommendedDates: "Late March to early May",
    totalBudget: "$1,400–$2,100",
    highlights: [
      "Sunrise at Delicate Arch",
      "Backcountry trails in Canyonlands",
      "Stargazing in a dark-sky park",
    ],
    assumptions: ["Traveling as a pair"],
    bestTimeNote: "Spring keeps the heat manageable.",
    vibeSummary: "Red rock labyrinths and desert silence.",
  },
  budget: {
    items: [
      { category: "Flights", range: "$400–$580", description: "Round trip per person" },
      { category: "Accommodation", range: "$500–$800", description: "5 nights" },
    ],
    total: "$1,400–$2,100",
  },
  flights: {
    skip: false,
    context: "Fly into Grand Junction or Salt Lake City.",
    options: [
      {
        description: "JFK to GJT via Denver — United, approx 7h total",
        price: "$430",
        url: "https://www.google.com/travel/flights?q=jfk-gjt",
        airline: "United",
        stops: "1 stop",
      },
    ],
  },
  accommodation: [
    {
      location: "Moab",
      nights: 5,
      options: [
        {
          name: "Desert Lodge",
          type: "Hotel",
          pricePerNight: "$100–$160",
          why: "Walkable to downtown",
          url: "https://www.booking.com/searchresults.html?ss=Desert+Lodge+Moab",
          isPrimary: true,
        },
      ],
    },
  ],
  bookingChecklist: [
    {
      item: "Arches timed entry",
      leadTime: "Book 3 months ahead",
      estimatedCost: "$2",
      url: "https://www.recreation.gov/timed-entry/10088426",
      priority: "high",
    },
  ],
  days: [
    {
      dayNumber: 1,
      title: "Arrival and Arches at golden hour",
      location: "Moab",
      transitNote: "Pick up rental car",
      periods: [
        {
          label: "Morning",
          activities: [
            {
              name: "Arrive and check in",
              description: "Land, pick up the car, drop bags in Moab.",
              duration: "2 hours",
              cost: "Free",
              tags: ["transit"],
            },
          ],
          dining: [
            {
              name: "Moab Diner",
              description: "Classic breakfast before the park.",
              priceRange: "$10–$15/person",
              url: "https://www.google.com/maps/search/?api=1&query=Moab+Diner+Moab",
              isPrimary: true,
            },
          ],
        },
        {
          label: "Afternoon",
          activities: [
            {
              name: "Arches scenic drive",
              description: "Windows Section and Balanced Rock.",
              duration: "3 hours",
              cost: "$30 per vehicle",
              tags: ["nature", "photo-worthy"],
              bookingUrl: "https://www.recreation.gov/timed-entry/10088426",
            },
          ],
          dining: [
            {
              name: "Quesadilla Mobilla",
              description: "Food-truck lunch downtown.",
              priceRange: "$8–$12/person",
              url: "https://www.google.com/maps/search/?api=1&query=Quesadilla+Mobilla+Moab",
              isPrimary: true,
            },
          ],
        },
        {
          label: "Evening",
          activities: [
            {
              name: "Sunset at Delicate Arch viewpoint",
              description: "Short walk to the lower viewpoint for golden hour.",
              duration: "1.5 hours",
              cost: "Free",
              tags: ["nature"],
            },
          ],
          dining: [
            {
              name: "Desert Bistro",
              description: "Southwestern dinner, book ahead.",
              priceRange: "$30–$45/person",
              url: "https://www.google.com/maps/search/?api=1&query=Desert+Bistro+Moab",
              isPrimary: true,
            },
          ],
        },
      ],
    },
    {
      dayNumber: 2,
      title: "Canyonlands Island in the Sky",
      location: "Moab",
      periods: [
        {
          label: "Morning",
          activities: [
            {
              name: "Mesa Arch sunrise",
              description: "Arrive before dawn for the classic shot.",
              duration: "2 hours",
              cost: "$30 per vehicle",
              tags: ["nature", "photo-worthy"],
            },
          ],
          dining: [
            {
              name: "Love Muffin Café",
              description: "Grab-and-go breakfast burritos.",
              priceRange: "$8–$14/person",
              url: "https://www.google.com/maps/search/?api=1&query=Love+Muffin+Cafe+Moab",
              isPrimary: true,
            },
          ],
        },
        {
          label: "Afternoon",
          activities: [
            {
              name: "Grand View Point trail",
              description: "Rim walk with thousand-foot drops on both sides.",
              duration: "2 hours",
              cost: "Free",
              tags: ["hiking"],
            },
          ],
          dining: [
            {
              name: "Trail picnic",
              description: "Pack lunch from town — nothing inside the park.",
              priceRange: "$5–$10/person",
              isPrimary: true,
            },
          ],
        },
        {
          label: "Evening",
          activities: [
            {
              name: "Stargazing at Dead Horse Point",
              description: "International dark-sky park minutes from the mesa.",
              duration: "2 hours",
              cost: "$20 per vehicle",
              tags: ["nature"],
            },
          ],
          dining: [
            {
              name: "Antica Forma",
              description: "Wood-fired pizza back in town.",
              priceRange: "$15–$25/person",
              url: "https://www.google.com/maps/search/?api=1&query=Antica+Forma+Moab",
              isPrimary: true,
            },
          ],
        },
      ],
    },
  ],
  alternatives: [
    {
      title: "Swap a day for the Needles district",
      description: "Quieter trails, 90 minutes south.",
      url: "https://www.google.com/search?q=needles+district+canyonlands",
    },
  ],
  sources: [
    {
      topic: "Permits and timed entry",
      citations: ["https://www.nps.gov/arch/planyourvisit/timed-entry-reservation.htm"],
    },
  ],
});
