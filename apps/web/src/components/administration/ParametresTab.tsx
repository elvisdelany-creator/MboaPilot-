import { useEffect, useState } from "react";
import { toast } from "sonner";
import { chargerInfosEntreprise, ErreurAuthentification, modifierEntrepriseRequete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InfosEntreprise } from "@/lib/types";

// 6.1, 8.8 : paramétrage des taxes applicables (le cas échéant) et des
// mentions légales figurant sur les documents commerciaux (6.7 — ticket de
// caisse, facture pro-forma). Champs vides par défaut : aucune obligation
// fiscale ou de mention n'est présumée pour l'utilisateur.
export function ParametresTab() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [entreprise, setEntreprise] = useState<InfosEntreprise["entreprise"] | null>(null);
  const [tauxTva, setTauxTva] = useState("");
  const [mentionsLegales, setMentionsLegales] = useState("");
  const [enCours, setEnCours] = useState(false);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerEntreprise() {
    chargerInfosEntreprise(token)
      .then((infos) => {
        setEntreprise(infos.entreprise);
        setTauxTva(infos.entreprise.tauxTva !== null ? String(infos.entreprise.tauxTva / 100) : "");
        setMentionsLegales(infos.entreprise.mentionsLegales ?? "");
      })
      .catch((e) => gererErreur(e, "Impossible de charger les paramètres de l'entreprise."));
  }

  useEffect(rechargerEntreprise, [token]);

  async function enregistrer() {
    setEnCours(true);
    try {
      // saisie en % courant (ex. 19,25), stocké en centièmes de % (1925)
      const tauxCentiemes = tauxTva.trim() === "" ? null : Math.round(Number(tauxTva.replace(",", ".")) * 100);
      await modifierEntrepriseRequete(token, { tauxTva: tauxCentiemes, mentionsLegales: mentionsLegales.trim() || null });
      toast.success("Paramètres enregistrés.");
      rechargerEntreprise();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'enregistrement des paramètres.");
    } finally {
      setEnCours(false);
    }
  }

  if (!entreprise) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Taxes et mentions légales</p>
      <Card className="max-w-xl gap-4 p-4">
        <div>
          <Label htmlFor="parametres-taux-tva">Taux de TVA applicable (%, optionnel)</Label>
          <Input
            id="parametres-taux-tva"
            type="number"
            min={0}
            step={0.01}
            value={tauxTva}
            onChange={(e) => setTauxTva(e.target.value)}
            placeholder="Aucune taxe si laissé vide"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Ajouté au total du ticket de caisse et de la facture pro-forma. Laisser vide si aucune taxe n'est applicable.
          </p>
        </div>
        <div>
          <Label htmlFor="parametres-mentions">Mentions légales (ticket de caisse, pro-forma)</Label>
          <textarea
            id="parametres-mentions"
            value={mentionsLegales}
            onChange={(e) => setMentionsLegales(e.target.value)}
            placeholder="Ex. RC/DLA/2024/B/1234 — NIU M012345678901"
            rows={3}
            className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <Button className="w-fit cursor-pointer" disabled={enCours} onClick={enregistrer}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </Card>
    </div>
  );
}
