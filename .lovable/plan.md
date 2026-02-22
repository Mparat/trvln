

# Fix Google Flights URLs to Include User's Travel Dates

## Problem Identified

The Google Flights links in the generated itinerary are currently static URLs (`https://www.google.com/flights`) that don't include the user's selected travel dates or departure city from the Logistics section. Meanwhile, Booking.com URLs correctly include check-in/check-out dates.

**Current (lines 540 and 1005-1006):**
```
- Flights: https://www.google.com/flights
```

**Booking.com correctly uses:**
```
- Hotels: https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
```

## Solution

Update the Google Flights URL pattern to include dates and route information using Google's travel search format.

## Implementation Details

### File to Modify
`supabase/functions/generate-itinerary/index.ts`

### Changes

**1. Update the fallback URL pattern (line 540):**

Change from:
```typescript
- Flights: https://www.google.com/flights
```

To:
```typescript
- Flights: https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DESTINATION${startDate ? `+departing+${formatDateForBooking(startDate)}` : ''}${endDate ? `+returning+${formatDateForBooking(endDate)}` : ''}
```

**2. Update the URL formatting rules section (lines 1005-1006):**

Change from:
```
**FOR FLIGHTS**:
- Use: https://www.google.com/flights
```

To:
```
**FOR FLIGHTS** - Use Google Flights with dates:
- Format: https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DESTINATION+departing+YYYY-MM-DD+returning+YYYY-MM-DD
- Example: [Search Flights](https://www.google.com/travel/flights?q=flights+from+New+York+to+Tokyo+departing+${startDate ? formatDateForBooking(startDate) : '2024-03-15'}+returning+${endDate ? formatDateForBooking(endDate) : '2024-03-25'})
- If no specific dates: https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DESTINATION
```

**3. Add departure city context to the flight URL instruction:**

Update the instructions to use the actual `departureCity` from user preferences:
```typescript
${departureCity ? `- User's departure city: ${departureCity} (use this as the flight origin)` : '- No departure city specified (use generic origin placeholder)'}
```

**4. Update the Flight Information section example (around line 755-765):**

Update the example to show the date-aware URL format:
```
- Book: [Search on Google Flights](https://www.google.com/travel/flights?q=flights+from+DEPARTURE_CITY+to+DESTINATION+departing+START_DATE+returning+END_DATE)
```

## Expected Outcome

After this change, when a user selects:
- **Departure City:** New York (JFK)
- **Start Date:** March 15, 2026
- **End Date:** March 25, 2026
- **Destination:** Tokyo

The generated flight links will be:
```
https://www.google.com/travel/flights?q=flights+from+New+York+to+Tokyo+departing+2026-03-15+returning+2026-03-25
```

This will open Google Flights with the search pre-populated with the user's dates and route, saving them from having to manually enter this information.

## Summary of Changes

| Location | Current | After |
|----------|---------|-------|
| Line 540 (fallback pattern) | Static `google.com/flights` | Date-aware URL with query parameters |
| Lines 1005-1006 (URL rules) | Static example | Dynamic example with dates and route |
| Flight section example | Generic book link | Date-aware Google Flights URL |

