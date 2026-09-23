import { useEffect, useState } from "react";
import { toast } from "sonner";
import { POLITIQUE_MDP_PAR_DEFAUT, validerMotDePasse, type PolitiqueMotDePasse } from "@mboapilot/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { chargerInfosEntreprise, reinitialiserMotDePasseRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CompteUtilisateur } from "@/lib/types";

interface Props {
  compte: CompteUtilisateur | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 8.7, 11.2 : un mot de passe oublié imposait jusqu'ici de désactiver le
// compte et d'en recréer un nouveau, fragmentant l'historique de l'employé
// (factures, mouvements de stock… tous rattachés à son utilisateur_id).
export function ReinitialiserMotDePasseDialog({ compte, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [motDePasse, setMotDePasse] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [politique, setPolitique] = useState<PolitiqueMotDePasse>(POLITIQUE_MDP_PAR_DEFAUT);

  useEffect(() => {
    if (!compte) {
      setMotDePasse("");
      return;
    }
    chargerInfosEntreprise(token)
      .then((infos) =>
        setPolitique({
          longueurMin: infos.entreprise.politiqueMdpLongueurMin,
          exigerMajuscule: infos.entreprise.politiqueMdpExigerMajuscule,
          exigerChiffre: infos.entreprise.politiqueMdpExigerChiffre,
          exigerCaractereSpecial: infos.entreprise.politiqueMdpExigerCaractereSpecial,
        })
      )
      .catch(() => setPolitique(POLITIQUE_MDP_PAR_DEFAUT));
  }, [compte, token]);

  const exigencesMdp = [
    `${politique.longueurMin} caractères minimum`,
    ...(politique.exigerMajuscule ? ["une majuscule"] : []),
    ...(politique.exigerChiffre ? ["un chiffre"] : []),
    ...(politique.exigerCaractereSpecial ? ["un caractère spécial"] : []),
  ].join(", ");

  const pretAValider = validerMotDePasse(motDePasse, politique).length === 0;

  async function valider() {
    if (!compte || !pretAValider) return;
    setEnCours(true);
    try {
      await reinitialiserMotDePasseRequete(token, compte.idUser, motDePasse);
      toast.success(`Mot de passe de « ${compte.identifiant} » réinitialisé.`);
      setMotDePasse("");
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la réinitialisation.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={compte !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          <DialogDescription>
            Compte « {compte?.identifiant} » — communiquez le nouveau mot de passe à {compte?.prenom} {compte?.nom} par un canal sûr.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="reinit-mot-de-passe">Nouveau mot de passe</Label>
          <Input id="reinit-mot-de-passe" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} className="mt-1" />
          <p className="mt-1 text-xs text-muted-foreground">Exigé : {exigencesMdp}.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Réinitialisation…" : "Réinitialiser"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
