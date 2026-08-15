import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleConfirmCheckout } from "../_shared/stripeHttp.ts";

// Thin wrapper: the handler also runs as a sub-route of generate-itinerary
// (which is what CI actually deploys). See _shared/stripeHttp.ts.
serve(handleConfirmCheckout);
