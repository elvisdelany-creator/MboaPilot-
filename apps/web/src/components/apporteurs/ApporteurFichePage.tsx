import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, LogOut } from "lucide-react";
import { chargerFicheApporteur, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ChangerMotDePasseDialog } from "@/components/layout/ChangerMotDePasseDialog";
import { FicheApporteurPanel } from "./FicheApporteurPanel";
import type { FicheApporteur } from "@/lib/types";

// 6.3, 2.5.1 : un compte de rôle APPORTEUR n'a accès en lecture qu'à sa propre
// fiche — pas de tableau de bord, de caisse ni de SAV pour ce rôle.
export function ApporteurFichePage() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [fiche, setFiche] = useState<FicheApporteur | null>(null);
  // 2.5.1 : chacun change SON mot de passe, l'apporteur comme les autres rôles (sinon il garde celui fixé par l'administrateur)
  const [motDePasseOuvert, setMotDePasseOuvert] = useState(false);

  useEffect(() => {
    if (utilisateur.idApporteur === null) return;
    chargerFicheApporteur(token, utilisateur.idApporteur)
      .then(setFiche)
      .catch((e) => {
        if (e instanceof ErreurAuthentification) {
          toast.error("Session expirée — veuillez vous reconnecter.");
          deconnecter();
          return;
        }
        toast.error(e instanceof Error ? e.message : "Impossible de charger votre fiche.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, utilisateur.idApporteur]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-4 py-3">
        <h1 className="font-heading text-lg font-semibold text-foreground">Ma fiche apporteur</h1>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span>{utilisateur.prenom} {utilisateur.nom}</span>
          <Button variant="ghost" size="icon" className="size-9 cursor-pointer" aria-label="Changer mon mot de passe" onClick={() => setMotDePasseOuvert(true)}>
            <KeyRound className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-9 cursor-pointer" aria-label="Se déconnecter" onClick={deconnecter}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>
      <ChangerMotDePasseDialog ouvert={motDePasseOuvert} onFerme={() => setMotDePasseOuvert(false)} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {utilisateur.idApporteur === null && (
            <p className="text-sm text-muted-foreground">Aucune fiche apporteur associée à ce compte.</p>
          )}
          {utilisateur.idApporteur !== null && !fiche && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {fiche && <FicheApporteurPanel fiche={fiche} />}
        </div>
      </main>
    </div>
  );
}
