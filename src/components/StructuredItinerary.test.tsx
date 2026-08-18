import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StructuredItinerary } from "./StructuredItinerary";
import { mergeEditedItinerary } from "@/lib/itineraryEdit";
import { makeItinerary } from "@/test/fixtures/itinerary";

// The redesigned itinerary view must survive a whole-itinerary edit: the edit
// response goes through mergeEditedItinerary and the result must render the
// tabbed layout, not crash and not fall back to the legacy markdown renderer.

describe("StructuredItinerary design", () => {
  it("renders the redesigned tabbed layout from generated data", () => {
    render(<StructuredItinerary data={makeItinerary()} />);

    // Tab navigation is the signature of the new design
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Days (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bookings" })).toBeInTheDocument();

    // Overview content
    expect(screen.getByRole("heading", { name: "Moab, Utah" })).toBeInTheDocument();
    expect(screen.getByText("Sunrise at Delicate Arch")).toBeInTheDocument();
    expect(screen.getByText("Getting there")).toBeInTheDocument();
    // Appears in both the summary pill row and the budget section
    expect(screen.getAllByText("$1,400–$2,100").length).toBeGreaterThan(0);
  });

  it("renders identically from a model edit response run through the merge path", () => {
    const previous = makeItinerary();

    // A realistic edit-itinerary response: planning stripped server-side, but
    // the model wrapped the JSON in a fence and dropped the sources field.
    const edited = makeItinerary();
    delete edited.sources;
    edited.days[1].title = "Canyonlands and a river swim";
    const responseBody = "```json\n" + JSON.stringify(edited) + "\n```";

    const merged = mergeEditedItinerary(responseBody, previous);
    expect(merged).not.toBeNull();

    render(<StructuredItinerary data={merged!} />);

    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Days (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Moab, Utah" })).toBeInTheDocument();
    expect(screen.getByText("Sunrise at Delicate Arch")).toBeInTheDocument();
  });
});
