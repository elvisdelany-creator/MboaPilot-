import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { chargerComptesPartages, chargerFamilles, ErreurAuthentification, modifierComptePartageRequete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NouveauComptePartageDialog } from "./NouveauComptePartageDialog";
import type { ComptePartage, Famille } from "@/lib/types";

// 5.9 : comptes partagés streaming — écrans occupés/max, identifiants
// visibles (déjà restreint aux rôles de vente par la route elle-même, 11.2).
export function ComptesPartagesTab() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [comptes, setComptes] = useState<ComptePartage[]>([]);
  const [familles, setFamilles] = useState<Famille[]>([]);
  const [dialogOuvert, setDialogOuvert] = useState(false);
  const [compteEnEdition, setCompteEnEdition] = useState<ComptePartage | null>(null);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerComptes() {
    chargerComptesPartages(token, utilisateur.siteId)
      .then(setComptes)
      .catch((e) => gererErreur(e, "Impossible de charger les comptes partagés."));
  }

  useEffect(rechargerComptes, [token, utilisateur.siteId]);
  useEffect(() => {
    chargerFamilles(token)
      .then(setFamilles)
      .catch(() => setFamilles([]));
  }, [token]);

  function libelleFamille(idFamille: number) {
    return familles.find((f) => f.idFamille === idFamille)?.libelle ?? `Famille n° ${idFamille}`;
  }

  async function basculerActif(compte: ComptePartage) {
    try {
      await modifierComptePartageRequete(token, compte.idComptePartage, { actif: compte.actif !== 1 });
      rechargerComptes();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la mise à jour du compte.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comptes partagés streaming ({comptes.length})</p>
        <Button
          size="sm"
          className="cursor-pointer gap-1"
          onClick={() => {
            setCompteEnEdition(null);
            setDialogOuvert(true);
          }}
        >
          <Plus className="size-4" />
          Nouveau compte
        </Button>
      </div>

      {comptes.length === 0 && <p className="text-sm text-muted-foreground">Aucun compte partagé.</p>}

      <ul className="space-y-2">
        {comptes.map((c) => (
          <li key={c.idComptePartage}>
            <Card className="gap-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-card-foreground">
                    {c.libelle} <span className="font-normal text-muted-foreground">— {libelleFamille(c.idFamille)}</span>
                  </p>
                  {c.identifiant && (
                    <p className="text-sm text-muted-foreground">
                      {c.identifiant}
                      {c.motDePasse ? ` · ${c.motDePasse}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={c.ecransOccupes >= c.nombreEcransMax ? "destructive" : "secondary"}>
                    {c.ecransOccupes} / {c.nombreEcransMax} écrans
                  </Badge>
                  <Badge variant={c.actif === 1 ? "default" : "outline"}>{c.actif === 1 ? "Actif" : "Inactif"}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => {
                      setCompteEnEdition(c);
                      setDialogOuvert(true);
                    }}
                  >
                    Modifier
                  </Button>
                  <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => basculerActif(c)}>
                    {c.actif === 1 ? "Désactiver" : "Réactiver"}
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <NouveauComptePartageDialog
        ouvert={dialogOuvert}
        familles={familles}
        compte={compteEnEdition}
        onFerme={() => setDialogOuvert(false)}
        onSucces={() => {
          setDialogOuvert(false);
          rechargerComptes();
        }}
      />
    </div>
  );
}
