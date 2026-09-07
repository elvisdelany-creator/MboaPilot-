import { useEffect, useState } from "react";
import { FileText, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ParcoursPaiementMobile, Produit } from "@/lib/types";
import type { PaiementSaisi } from "./TicketPanel";

export interface LignePanier {
  produit: Produit;
  quantite: number;
  remise: number; // 6.4 : remise ponctuelle en FCFA sur cette ligne
}

interface Props {
  panier: LignePanier[];
  onIncrementer: (idProduit: number) => void;
  onDecrementer: (idProduit: number) => void;
  onRetirer: (idProduit: number) => void;
  onModifierRemise: (idProduit: number, remise: number) => void;
  enCours: boolean;
  onValider: (paiement: PaiementSaisi) => void;
  onImprimerProForma: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

function montantLigne(ligne: LignePanier): number {
  return Math.max(0, ligne.produit.prixVente * ligne.quantite - ligne.remise);
}

// 9.2 : ticket en cours pour une vente de produits/services hors abonnement —
// même logique d'encaissement (comptant/Mobile Money) que TicketPanel, mais
// panier multi-lignes avec quantités au lieu d'une formule + un kit unique.
export function TicketProduitsPanel({ panier, onIncrementer, onDecrementer, onRetirer, onModifierRemise, enCours, onValider, onImprimerProForma }: Props) {
  const total = panier.reduce((somme, l) => somme + montantLigne(l), 0);

  const [modePaiement, setModePaiement] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [montant, setMontant] = useState(total);
  const [numeroTelephone, setNumeroTelephone] = useState("");
  const [parcours, setParcours] = useState<ParcoursPaiementMobile>("USSD_CLIENT");
  useEffect(() => setMontant(total), [total]);

  const pretAValider = panier.length > 0 && !enCours && (modePaiement === "CASH" || numeroTelephone.trim().length > 0);

  function valider() {
    if (modePaiement === "CASH") onValider({ mode: "CASH", montant });
    else onValider({ mode: "MOBILE_MONEY", montant: total, numeroTelephone: numeroTelephone.trim(), parcours });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-border bg-card lg:w-80">
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ticket en cours</h2>

        {panier.length === 0 && <p className="text-sm text-muted-foreground">Aucun article sélectionné.</p>}

        <ul className="space-y-3">
          {panier.map((ligne) => (
            <li key={ligne.produit.idProduit} className="text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="text-card-foreground">{ligne.produit.libelle}</span>
                <button
                  type="button"
                  onClick={() => onRetirer(ligne.produit.idProduit)}
                  aria-label={`Retirer ${ligne.produit.libelle} du panier`}
                  className="cursor-pointer text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-6 cursor-pointer"
                    onClick={() => onDecrementer(ligne.produit.idProduit)}
                    aria-label={`Diminuer la quantité de ${ligne.produit.libelle}`}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-6 text-center tabular-nums">{ligne.quantite}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-6 cursor-pointer"
                    onClick={() => onIncrementer(ligne.produit.idProduit)}
                    aria-label={`Augmenter la quantité de ${ligne.produit.libelle}`}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
                <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(montantLigne(ligne))} FCFA</span>
              </div>
              {/* 6.4 : "remise ponctuelle" — montant en FCFA déduit du prix catalogue de la ligne */}
              <div className="mt-1 flex items-center gap-2">
                <Label htmlFor={`remise-${ligne.produit.idProduit}`} className="text-xs font-normal text-muted-foreground">
                  Remise
                </Label>
                <Input
                  id={`remise-${ligne.produit.idProduit}`}
                  type="number"
                  min={0}
                  max={ligne.produit.prixVente * ligne.quantite}
                  value={ligne.remise || ""}
                  placeholder="0"
                  onChange={(e) => onModifierRemise(ligne.produit.idProduit, Number(e.target.value))}
                  className="h-7 flex-1 tabular-nums"
                />
                <span className="text-xs text-muted-foreground">FCFA</span>
              </div>
            </li>
          ))}
        </ul>

        <Separator className="my-4" />

        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums text-primary">{formateurFcfa.format(total)} FCFA</span>
        </div>

        <div className="mt-4">
          <Label htmlFor="mode-paiement-produits">Mode de paiement</Label>
          <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as "CASH" | "MOBILE_MONEY")}>
            <SelectTrigger id="mode-paiement-produits" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">Comptant (cash)</SelectItem>
              <SelectItem value="MOBILE_MONEY">Mobile Money (Orange Money)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {modePaiement === "CASH" && (
          <div className="mt-4">
            <Label htmlFor="montant-encaisse-produits">Montant encaissé (comptant)</Label>
            <Input
              id="montant-encaisse-produits"
              type="number"
              min={0}
              value={montant}
              onChange={(e) => setMontant(Number(e.target.value))}
              className="mt-1 h-11 text-base tabular-nums"
            />
            {montant > 0 && montant < total && (
              <p className="mt-1 text-sm text-alert-j3-fg">
                Encaissement partiel — solde de {formateurFcfa.format(total - montant)} FCFA restant dû.
              </p>
            )}
          </div>
        )}

        {modePaiement === "MOBILE_MONEY" && (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="mobile-money-telephone-produits">Numéro de téléphone</Label>
              <Input
                id="mobile-money-telephone-produits"
                type="tel"
                value={numeroTelephone}
                onChange={(e) => setNumeroTelephone(e.target.value)}
                placeholder="690000000"
                className="mt-1 h-11 text-base"
              />
            </div>
            <div>
              <Label htmlFor="mobile-money-parcours-produits">Parcours</Label>
              <Select value={parcours} onValueChange={(v) => setParcours(v as ParcoursPaiementMobile)}>
                <SelectTrigger id="mobile-money-parcours-produits" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USSD_CLIENT">USSD (le client génère l'OTP)</SelectItem>
                  <SelectItem value="PUSH_MARCHAND">Push (notification envoyée au client)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border p-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full cursor-pointer gap-2"
          disabled={panier.length === 0}
          onClick={onImprimerProForma}
        >
          <FileText className="size-4" />
          Facture pro-forma
        </Button>
        <Button type="button" size="lg" className="h-12 w-full cursor-pointer text-base" disabled={!pretAValider} onClick={valider}>
          {enCours ? "Encaissement…" : modePaiement === "CASH" ? "Valider et encaisser" : "Initier le paiement Mobile Money"}
        </Button>
      </div>
    </aside>
  );
}
