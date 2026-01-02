import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Listen for postMessage from iframes to open external URLs
// This handles the case when this app is hosting other content
window.addEventListener('message', (event) => {
  if (event.data?.type === 'OPEN_EXTERNAL_URL' && typeof event.data.url === 'string') {
    window.open(event.data.url, '_blank', 'noopener,noreferrer');
  }
});

createRoot(document.getElementById("root")!).render(<App />);
