import { useEffect, useRef } from "react";

// Pages liste + détail : sur téléphone (< 768 px) le détail s'empile sous la liste. Après un choix dans la liste, il serait hors de
// l'écran : on y amène la vue. Sans animation quand l'utilisateur a demandé à les réduire ; jamais sur grand écran, où les deux
// zones sont côte à côte.
export function useDefilerVersDetail<T extends HTMLElement>(cle: number | string | null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (cle === null || !ref.current) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const sansMouvement = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current.scrollIntoView({ behavior: sansMouvement ? "auto" : "smooth", block: "start" });
  }, [cle]);
  return ref;
}
