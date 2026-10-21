import { Printer, RotateCcw } from "lucide-react";
import { construireUrlVerification, lireDateServeur } from "@mboapilot/shared";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { QrCode } from "@/components/ui/qr-code";
import type { InfosEntreprise } from "@/lib/types";

export interface LigneRecu {
  libelle: string;
  montant: number;
}

export interface RecuVente {
  operation: "Recrutement" | "Réabonnement" | "Vente";
  numeroAbonnement: number | null;
  lignes: LigneRecu[];
  total: number;
  // 3.2.3, 6.1, 8.8 : montant de taxe déjà figé sur la facture au moment de
  // sa création (jamais recalculé ici avec le taux courant, qui peut avoir
  // changé depuis) — 0 si aucune taxe n'était configurée
  montantTaxe: number;
  modePaiement: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  montantEncaisse: number;
  dateHeure: string;
  // 13.1 : "QR code de vérification sur factures et tickets" — identifiant
  // et jeton de la facture réellement créée, pour construire l'URL publique
  idFacture: number;
  jetonVerification: string;
  // 6.4 (règle 2) : une facture BROUILLON (aucun encaissement) ne s'imprime ni ne se transmet jamais
  statutFacture: "BROUILLON" | "VALIDEE";
}

interface Props {
  infosEntreprise: InfosEntreprise | null;
  // 3.2.1, 13.2 : logo de l'entreprise, déjà résolu en URL locale (blob) par
  // l'appelant — l'endpoint qui le sert exige une authentification Bearer
  logoUrl: string | null;
  recu: RecuVente;
  onNouvelleVente: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const LIBELLE_MODE_PAIEMENT: Record<"CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY", string> = {
  CASH: "Comptant",
  CHEQUE: "Chèque",
  VIREMENT: "Virement bancaire",
  MOBILE_MONEY: "Mobile Money",
};

// 6.7, 9.2 : ticket de caisse — édité immédiatement au comptoir après
// encaissement. Mise en page pensée pour une imprimante thermique 80mm
// (window.print(), comme l'export PDF de la fiche 360°, 8.1) mais lisible à
// l'écran en attendant l'intégration matérielle.
export function RecuVentePrintable({ infosEntreprise, logoUrl, recu, onNouvelleVente }: Props) {
  const monnaieRendue = recu.modePaiement === "CASH" ? Math.max(0, recu.montantEncaisse - recu.total) : 0;
  const soldeDu = Math.max(0, recu.total - recu.montantEncaisse);

  // 3.2.3, 6.1, 8.8 : "porte le total, la TVA/taxes le cas échéant" — montant
  // figé sur la facture à sa création, jamais recalculé ici avec le taux
  // courant (qui peut avoir changé depuis l'émission de ce ticket)
  const { montantTaxe } = recu;
  const adressePublique = infosEntreprise?.entreprise.adressePubliqueVerification ?? null;
  const montantHT = recu.total - montantTaxe;
  const taxeApplicable = montantTaxe !== 0;

  if (recu.statutFacture === "BROUILLON") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-6 text-card-foreground">
          <h2 className="font-heading text-lg font-semibold">Vente enregistrée, en attente d'encaissement</h2>
          <p className="text-sm">
            {recu.operation} — facture n° {recu.idFacture} : {formateurFcfa.format(recu.total)} {infosEntreprise?.entreprise.devise ?? "FCFA"} restent dus.
          </p>
          <p className="text-sm text-muted-foreground">
            Une facture sans encaissement ne s'imprime pas et ne se transmet pas au client. Le ticket sera disponible dès le premier encaissement, même partiel.
          </p>
          <Button autoFocus className="cursor-pointer gap-2" onClick={onNouvelleVente}>
            <RotateCcw className="size-4" />
            Nouvelle vente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-background p-6">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="w-full max-w-xs space-y-3 border border-border bg-card p-4 font-mono text-sm text-card-foreground print:border-none">
        <div className="text-center">
          {logoUrl && <img src={logoUrl} alt="" className="mx-auto mb-1 max-h-12 object-contain" />}
          <p className="font-semibold">{infosEntreprise?.entreprise.nom ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{infosEntreprise?.site.nom}</p>
          {infosEntreprise?.site.adresse && <p className="text-xs text-muted-foreground">{infosEntreprise.site.adresse}</p>}
        </div>

        <Separator />

        <p className="text-xs">{formateurDateHeure.format(lireDateServeur(recu.dateHeure))}</p>
        <p className="text-xs">{recu.numeroAbonnement !== null ? `${recu.operation} — abonnement n° ${recu.numeroAbonnement}` : recu.operation}</p>

        <Separator />

        <ul className="space-y-1">
          {recu.lignes.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span>{l.libelle}</span>
              <span className="tabular-nums">{formateurFcfa.format(l.montant)}</span>
            </li>
          ))}
        </ul>

        <Separator />

        {taxeApplicable && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total HT</span>
              <span className="tabular-nums">{formateurFcfa.format(montantHT)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>dont TVA</span>
              <span className="tabular-nums">{formateurFcfa.format(montantTaxe)}</span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between font-semibold">
          <span>TOTAL{taxeApplicable ? " TTC" : ""}</span>
          <span className="tabular-nums">{formateurFcfa.format(recu.total)} {infosEntreprise?.entreprise.devise ?? "FCFA"}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>{LIBELLE_MODE_PAIEMENT[recu.modePaiement]}</span>
          <span className="tabular-nums">{formateurFcfa.format(recu.montantEncaisse)}</span>
        </div>
        {monnaieRendue > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span>Monnaie rendue</span>
            <span className="tabular-nums">{formateurFcfa.format(monnaieRendue)}</span>
          </div>
        )}
        {soldeDu > 0 && (
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Solde restant dû</span>
            <span className="tabular-nums">{formateurFcfa.format(soldeDu)}</span>
          </div>
        )}

        <Separator />

        {/* 13.1 : le QR mène à l'adresse PUBLIQUE de la boutique (Paramètres) ; sans elle, un lien « localhost » serait
            mort sur le téléphone du client : aucun QR n'est alors imprimé */}
        {adressePublique && (
          <>
            <div className="flex flex-col items-center gap-1">
              <QrCode valeur={construireUrlVerification(adressePublique, recu.idFacture, recu.jetonVerification)} taille={80} />
              <p className="text-[10px] text-muted-foreground">Scanner pour vérifier ce document</p>
            </div>

            <Separator />
          </>
        )}

        <p className="text-center text-xs text-muted-foreground">{infosEntreprise?.entreprise.mentionsLegales || "Merci de votre confiance."}</p>
      </div>

      <div className="no-print mt-6 flex gap-2">
        {/* le focus arrive ici une fois la vente encaissée (au clavier : Entrée pour la suivante, au lieu de refaire le tour de la page) */}
        <Button autoFocus variant="outline" className="cursor-pointer gap-2" onClick={onNouvelleVente}>
          <RotateCcw className="size-4" />
          Nouvelle vente
        </Button>
        <Button className="cursor-pointer gap-2" onClick={() => window.print()}>
          <Printer className="size-4" />
          Imprimer le ticket
        </Button>
      </div>
    </div>
  );
}
