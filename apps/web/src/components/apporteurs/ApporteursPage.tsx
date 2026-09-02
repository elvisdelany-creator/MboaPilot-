import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Users } from "lucide-react";
import { chargerApporteurs, chargerFicheApporteur, ErreurAuthentification, modifierApporteurRequete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NouvelApporteurDialog } from "./NouvelApporteurDialog";
import { FicheApporteurPanel } from "./FicheApporteurPanel";
import type { Apporteur, FicheApporteur } from "@/lib/types";

interface Props {
  onNaviguer: (vue: Vue) => void;
}

// 6.3 : gestion des apporteurs d'affaires (Administrateur/Gérant) — liste,
// création, activation/désactivation et consultation de la fiche consolidée.
export function ApporteursPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [apporteurs, setApporteurs] = useState<Apporteur[] | null>(null);
  const [idSelectionne, setIdSelectionne] = useState<number | null>(null);
  const [fiche, setFiche] = useState<FicheApporteur | null>(null);
  const [nouveauOuvert, setNouveauOuvert] = useState(false);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerListe() {
    chargerApporteurs(token)
      .then(setApporteurs)
      .catch((e) => gererErreur(e, "Impossible de charger les apporteurs."));
  }

  function rechargerFiche(id: number) {
    chargerFicheApporteur(token, id)
      .then(setFiche)
      .catch((e) => gererErreur(e, "Impossible de charger la fiche apporteur."));
  }

  useEffect(rechargerListe, [token]);

  useEffect(() => {
    if (idSelectionne !== null) rechargerFiche(idSelectionne);
    else setFiche(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSelectionne]);

  async function basculerActif(apporteur: Apporteur) {
    try {
      await modifierApporteurRequete(token, apporteur.idApporteur, { actif: apporteur.actif !== 1 });
      rechargerListe();
      if (idSelectionne === apporteur.idApporteur) rechargerFiche(apporteur.idApporteur);
    } catch (erreur) {
      gererErreur(erreur, "Échec de la mise à jour de l'apporteur.");
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="apporteurs" onNaviguer={onNaviguer} />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h1 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">Apporteurs</h1>
            <Button size="sm" className="cursor-pointer gap-1" onClick={() => setNouveauOuvert(true)}>
              <Plus className="size-4" />
              Nouveau
            </Button>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {apporteurs?.length === 0 && <li className="p-4 text-sm text-muted-foreground">Aucun apporteur.</li>}
            {apporteurs?.map((a) => (
              <li key={a.idApporteur}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 border-b border-border px-4 py-3 text-left hover:bg-muted ${idSelectionne === a.idApporteur ? "bg-muted" : ""}`}
                  onClick={() => setIdSelectionne(a.idApporteur)}
                >
                  <span className="font-medium text-foreground">{a.nom}</span>
                  <Badge variant={a.actif === 1 ? "default" : "outline"}>{a.actif === 1 ? "Actif" : "Inactif"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!fiche && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Users className="mx-auto mb-2 size-8" />
                Sélectionnez un apporteur pour voir sa fiche.
              </div>
            </div>
          )}

          {fiche && (
            <div className="mx-auto max-w-2xl space-y-6">
              <FicheApporteurPanel fiche={fiche} />
              <Button variant="outline" className="cursor-pointer" onClick={() => basculerActif(fiche.apporteur)}>
                {fiche.apporteur.actif === 1 ? "Désactiver cet apporteur" : "Réactiver cet apporteur"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <NouvelApporteurDialog
        ouvert={nouveauOuvert}
        onFerme={() => setNouveauOuvert(false)}
        onSucces={() => { setNouveauOuvert(false); rechargerListe(); }}
      />
    </div>
  );
}
