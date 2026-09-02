import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fusionnerAbonnesRequete, rechercherAbonnes, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne } from "@/lib/types";

interface Props {
  abonnePrincipal: Abonne | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 8.1 : fusion de doublons — opération destructrice (suppression définitive
// de la fiche doublon après rattachement de tout son historique à la fiche
// principale), confirmation explicite obligatoire avant exécution (9.1).
export function FusionDoublonsDialog({ abonnePrincipal, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<Abonne[]>([]);
  const [doublon, setDoublon] = useState<Abonne | null>(null);
  const [enCours, setEnCours] = useState(false);

  const ouvert = abonnePrincipal !== null;

  useEffect(() => {
    if (!ouvert) {
      setTerme("");
      setResultats([]);
      setDoublon(null);
    }
  }, [ouvert]);

  useEffect(() => {
    if (!terme.trim() || !abonnePrincipal) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherAbonnes(token, abonnePrincipal.siteId, terme)
        .then((data) => setResultats(data.filter((a) => a.idAbonne !== abonnePrincipal.idAbonne)))
        .catch(() => setResultats([]));
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, token, abonnePrincipal]);

  async function confirmer() {
    if (!abonnePrincipal || !doublon) return;
    setEnCours(true);
    try {
      await fusionnerAbonnesRequete(token, {
        idAbonnePrincipal: abonnePrincipal.idAbonne,
        idAbonneDoublon: doublon.idAbonne,
        userId: utilisateur.idUser,
      });
      toast.success(`Fiche « ${doublon.prenom} ${doublon.nom} » fusionnée et supprimée — historique conservé.`);
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la fusion.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionner un doublon</DialogTitle>
          <DialogDescription>
            Rattache l'historique d'une fiche doublon à « {abonnePrincipal?.prenom} {abonnePrincipal?.nom} » (n° {abonnePrincipal?.idAbonne}), puis supprime le doublon.
          </DialogDescription>
        </DialogHeader>

        {!doublon && (
          <div className="space-y-2">
            <Input
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
              placeholder="Rechercher la fiche doublon (nom, téléphone, n° abonné)…"
              className="h-11"
            />
            {resultats.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
                {resultats.map((a) => (
                  <li key={a.idAbonne}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer flex-col items-start px-4 py-2.5 text-left hover:bg-muted"
                      onClick={() => setDoublon(a)}
                    >
                      <span className="font-medium text-popover-foreground">{a.prenom} {a.nom}</span>
                      <span className="text-sm text-muted-foreground">n° {a.idAbonne} · {a.telephone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {doublon && (
          <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <p className="text-sm text-card-foreground">
                La fiche <strong>{doublon.prenom} {doublon.nom}</strong> (n° {doublon.idAbonne}) sera <strong>définitivement supprimée</strong>. Ses
                abonnements, factures et dossiers SAV seront rattachés à « {abonnePrincipal?.prenom} {abonnePrincipal?.nom} ». Cette action est irréversible.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setDoublon(null)}>
              Choisir une autre fiche
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={!doublon || enCours} onClick={confirmer}>
            {enCours ? "Fusion…" : "Confirmer la fusion et supprimer le doublon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
