import { useEffect, useState } from "react";

/**
 * Tracks the OS "reduce motion" setting. CSS handles most of it, but SVG
 * (SMIL) animation ignores media queries, so anything driven that way has to
 * be switched off in React instead.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return prefersReduced;
}
