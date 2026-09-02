import type { PointEvolutionCA } from "@/lib/types";

interface Props {
  points: PointEvolutionCA[];
}

const LARGEUR = 600;
const HAUTEUR = 160;
const MARGE = 24;

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateCourte = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });

// 9.3 : courbe d'évolution du CA sur une période glissante — rendu SVG fait
// main (pas de dépendance de charting pour une seule courbe simple).
export function EvolutionCaChart({ points }: Props) {
  if (points.length === 0) return null;

  const max = Math.max(...points.map((p) => p.montant), 1);
  const pasX = points.length > 1 ? (LARGEUR - MARGE * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: MARGE + i * pasX,
    y: HAUTEUR - MARGE - (p.montant / max) * (HAUTEUR - MARGE * 2),
    point: p,
  }));

  const ligne = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const aire = `${ligne} L ${coords[coords.length - 1].x} ${HAUTEUR - MARGE} L ${coords[0].x} ${HAUTEUR - MARGE} Z`;

  return (
    <svg viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} className="w-full" role="img" aria-label="Évolution du chiffre d'affaires">
      <path d={aire} className="fill-primary/10" />
      <path d={ligne} className="fill-none stroke-primary" strokeWidth={2} />
      {coords.map((c) => (
        <g key={c.point.date}>
          <circle cx={c.x} cy={c.y} r={2.5} className="fill-primary" />
          <title>
            {formateurDateCourte.format(new Date(c.point.date))} — {formateurFcfa.format(c.point.montant)} FCFA
          </title>
        </g>
      ))}
    </svg>
  );
}
