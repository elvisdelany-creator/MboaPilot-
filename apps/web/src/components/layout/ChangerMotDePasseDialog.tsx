import { useEffect, useState } from "react";
import { toast } from "sonner";
import { POLITIQUE_MDP_PAR_DEFAUT, validerMotDePasse, type PolitiqueMotDePasse } from "@mboapilot/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { changerSonMotDePasseRequete, chargerInfosEntreprise, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  ouvert: boolean;
  onFerme: () => void;
}

// 2.5.1 : « authentification individuelle » — chaque utilisateur choisit son mot de passe, qu'aucun
// administrateur n'a besoin de connaître.
export function ChangerMotDePasseDialog({ ouvert, onFerme }: Props) {
  const { session, ouvrirSession, deconnecter } = useAuth();
  const token = session!.token;

  const [actuel, setActuel] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [politique, setPolitique] = useState<PolitiqueMotDePasse>(POLITIQUE_MDP_PAR_DEFAUT);

  useEffect(() => {
    if (!ouvert) {
      setActuel("");
      setNouveau("");
      setConfirmation("");
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
  }, [ouvert, token]);

  const exigences = [
    `${politique.longueurMin} caractères minimum`,
    ...(politique.exigerMajuscule ? ["une majuscule"] : []),
    ...(politique.exigerChiffre ? ["un chiffre"] : []),
    ...(politique.exigerCaractereSpecial ? ["un caractère spécial"] : []),
  ].join(", ");

  const nouveauValide = validerMotDePasse(nouveau, politique).length === 0;
  const confirmationDifferente = confirmation !== "" && confirmation !== nouveau;
  const pretAValider = actuel !== "" && nouveauValide && confirmation === nouveau && nouveau !== actuel;

  async function valider() {
    if (!pretAValider) return;
    setEnCours(true);
    try {
      const nouveauToken = await changerSonMotDePasseRequete(token, actuel, nouveau);
      ouvrirSession(nouveauToken, session!.utilisateur); // l'ancien jeton ne vaut plus : on poursuit avec le neuf
      toast.success("Votre mot de passe a été changé.");
      onFerme();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec du changement de mot de passe.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changer mon mot de passe</DialogTitle>
          <DialogDescription>Choisissez un mot de passe que vous seul connaissez.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="mdp-actuel">Mot de passe actuel</Label>
            <Input id="mdp-actuel" type="password" autoComplete="current-password" value={actuel} onChange={(e) => setActuel(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="mdp-nouveau">Nouveau mot de passe</Label>
            <Input id="mdp-nouveau" type="password" autoComplete="new-password" value={nouveau} onChange={(e) => setNouveau(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-muted-foreground">Exigé : {exigences}.</p>
          </div>
          <div>
            <Label htmlFor="mdp-confirmation">Confirmer le nouveau mot de passe</Label>
            <Input id="mdp-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1" />
            {confirmationDifferente && <p className="mt-1 text-xs text-destructive">Les deux saisies sont différentes.</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Changement…" : "Changer le mot de passe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
