import { QrCode } from "@/components/ui/qr-code";
import { cn } from "@/lib/utils";
import type { InfosEntreprise } from "@/lib/types";
import type { FormatImpression } from "./format-impression";

const OPTIONS_FORMAT: { valeur: FormatImpression; libelle: string }[] = [
  { valeur: "TICKET", libelle: "Ticket 80 mm" },
  { valeur: "A5X2", libelle: "A5 × 2" },
];

export function SelecteurFormatImpression({ format, onChange }: { format: FormatImpression; onChange: (format: FormatImpression) => void }) {
  return (
    <div role="radiogroup" aria-label="Format d'impression" className="inline-flex rounded-md border border-border p-0.5">
      {OPTIONS_FORMAT.map((option) => {
        const actif = format === option.valeur;
        return (
          <button
            key={option.valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            onClick={() => onChange(option.valeur)}
            className={cn(
              "min-h-11 cursor-pointer rounded px-3 md:min-h-9 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              actif ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
            )}
          >
            {option.libelle}
          </button>
        );
      })}
    </div>
  );
}

export interface LigneMontantA5 {
  libelle: string;
  montant: number;
  gras?: boolean;
}

// ce que la feuille sait afficher : déjà mis en forme par l'écran appelant (reçu de caisse, duplicata, pro-forma)
export interface DocumentA5 {
  titre: string; // « Facture », « Pro-forma »
  numero?: string; // « N° 123 »
  date: string;
  client?: string;
  operation?: string;
  bandeau?: { titre: string; detail?: string }; // DUPLICATA, PRO-FORMA : encadré bien visible sur chaque exemplaire
  lignes: LigneMontantA5[];
  detailsTotal?: LigneMontantA5[]; // total HT, dont TVA
  libelleTotal: string;
  total: number;
  devise: string;
  reglements?: LigneMontantA5[];
  soldes?: LigneMontantA5[]; // monnaie rendue, solde restant dû
  qr?: string; // adresse de vérification : absente, aucun QR n'est imprimé
  note?: string;
  mentions?: string;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

interface PropsFeuille {
  infosEntreprise: InfosEntreprise | null;
  // logo déjà résolu en URL locale (blob) par l'appelant : l'endpoint qui le sert exige une authentification Bearer
  logoUrl: string | null;
  document: DocumentA5;
}

export function FeuilleA5x2({ infosEntreprise, logoUrl, document }: PropsFeuille) {
  return (
    <>
      {/* la feuille est un A4 paysage sans marge : chaque moitié mesure exactement un A5 portrait */}
      <style>{`@media print { @page { size: A4 landscape; margin: 0; } }`}</style>
      <div
        data-format="A5X2"
        className="grid w-full max-w-5xl divide-y divide-dashed divide-neutral-400 border border-neutral-300 bg-white text-neutral-900 md:grid-cols-2 md:divide-x md:divide-y-0 print:w-[297mm] print:max-w-none print:grid-cols-2 print:divide-x print:divide-y-0 print:border-0"
      >
        <Exemplaire etiquette="Exemplaire client" infosEntreprise={infosEntreprise} logoUrl={logoUrl} document={document} />
        <Exemplaire etiquette="Exemplaire boutique" infosEntreprise={infosEntreprise} logoUrl={logoUrl} document={document} />
      </div>
    </>
  );
}

function Exemplaire({ etiquette, infosEntreprise, logoUrl, document }: PropsFeuille & { etiquette: string }) {
  const entreprise = infosEntreprise?.entreprise;
  const site = infosEntreprise?.site;
  return (
    <section
      aria-label={etiquette}
      className="relative flex flex-col gap-3 p-5 text-[11px] leading-snug md:aspect-[148.5/210] print:box-border print:h-[210mm] print:w-[148.5mm] print:p-[10mm] print:[break-inside:avoid]"
    >
      <p className="text-right text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-600">{etiquette}</p>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {logoUrl && <img src={logoUrl} alt="" className="mb-1 max-h-12 max-w-32 object-contain object-left" />}
          <p className="font-heading text-sm font-semibold">{entreprise?.nom ?? "—"}</p>
          {site?.nom && <p className="text-neutral-700">{site.nom}</p>}
          {site?.adresse && <p className="text-neutral-700">{site.adresse}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-heading text-lg font-semibold uppercase tracking-wide">{document.titre}</p>
          {document.numero && <p className="font-medium tabular-nums">{document.numero}</p>}
          <p className="text-neutral-700">{document.date}</p>
        </div>
      </header>

      {document.bandeau && (
        <div role="note" className="border-2 border-neutral-900 px-2 py-1 text-center">
          <p className="text-xs font-bold uppercase tracking-widest">{document.bandeau.titre}</p>
          {document.bandeau.detail && <p className="text-[10px]">{document.bandeau.detail}</p>}
        </div>
      )}

      {(document.client || document.operation) && (
        <div className="space-y-0.5">
          {document.client && <p>Client : <span className="font-medium">{document.client}</span></p>}
          {document.operation && <p>{document.operation}</p>}
        </div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-900 text-left text-[10px] uppercase tracking-wide">
            <th className="py-1 font-semibold">Désignation</th>
            <th className="py-1 text-right font-semibold">Montant ({document.devise})</th>
          </tr>
        </thead>
        <tbody>
          {document.lignes.map((ligne, i) => (
            <tr key={i} className="border-b border-neutral-300 align-top">
              <td className="py-1 pr-2">{ligne.libelle}</td>
              <td className="py-1 text-right tabular-nums">{formateurFcfa.format(ligne.montant)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto w-3/5 space-y-0.5">
        {document.detailsTotal?.map((d, i) => (
          <div key={i} className="flex justify-between gap-2 text-neutral-700">
            <span>{d.libelle}</span>
            <span className="tabular-nums">{formateurFcfa.format(d.montant)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-2 border-t-2 border-neutral-900 pt-1 text-sm font-semibold">
          <span>{document.libelleTotal}</span>
          <span className="tabular-nums">{formateurFcfa.format(document.total)} {document.devise}</span>
        </div>
      </div>

      {document.reglements && document.reglements.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide">Règlement</p>
          {document.reglements.map((r, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span>{r.libelle}</span>
              <span className="tabular-nums">{formateurFcfa.format(r.montant)}</span>
            </div>
          ))}
          {document.soldes?.map((s, i) => (
            <div key={i} className={cn("flex justify-between gap-2", s.gras && "font-semibold")}>
              <span>{s.libelle}</span>
              <span className="tabular-nums">{formateurFcfa.format(s.montant)}</span>
            </div>
          ))}
        </div>
      )}

      {document.note && <p className="text-neutral-700">{document.note}</p>}

      <footer className="mt-auto flex items-end justify-between gap-3 border-t border-neutral-300 pt-2">
        <p className="min-w-0 text-[10px] text-neutral-700">{document.mentions}</p>
        {document.qr && (
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            <QrCode valeur={document.qr} taille={72} />
            <p className="text-[8px] text-neutral-700">Scanner pour vérifier</p>
          </div>
        )}
      </footer>
    </section>
  );
}
