import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { chargerCatalogueDepartRequete, chargerOperateursDepart, ErreurAuthentification, type OperateurDepart, type ResultatChargementDepart } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  ouvert: boolean;
  onFerme: () => void;
  onSucces: () => void;
}

function pluriel(n: number, singulier: string, plurielMot = `${singulier}s`) {
  return `${n} ${n > 1 ? plurielMot : singulier}`;
}

// Annexe 14.1 du cahier des charges : tarifs de référence des opérateurs à charger en un clic plutôt qu'à saisir à la main.
// Rien n'est écrasé (ce qui existe déjà est conservé) et tout reste modifiable ensuite dans cet écran (8.8).
export function CatalogueDepartDialog({ ouvert, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [operateurs, setOperateurs] = useState<OperateurDepart[]>([]);
  const [chargementListe, setChargementListe] = useState(false);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ResultatChargementDepart | null>(null);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  useEffect(() => {
    if (!ouvert) return;
    setChoisis([]);
    setResultat(null);
    setChargementListe(true);
    chargerOperateursDepart(token)
      .then(setOperateurs)
      .catch((e) => gererErreur(e, "Impossible de charger la liste des opérateurs."))
      .finally(() => setChargementListe(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, token]);

  function basculer(cle: string, coche: boolean) {
    setChoisis((courant) => (coche ? [...courant, cle] : courant.filter((c) => c !== cle)));
  }

  async function charger() {
    if (choisis.length === 0) return;
    setEnCours(true);
    try {
      setResultat(await chargerCatalogueDepartRequete(token, choisis));
      onSucces();
    } catch (erreur) {
      gererErreur(erreur, "Échec du chargement du catalogue de départ.");
    } finally {
      setEnCours(false);
    }
  }

  const notesChoisies = operateurs.filter((o) => choisis.includes(o.cle)).flatMap((o) => o.notes);

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {resultat ? (
          <>
            <DialogHeader>
              <DialogTitle>Catalogue chargé</DialogTitle>
              <DialogDescription>
                {pluriel(resultat.crees.formules, "formule")}, {pluriel(resultat.crees.kits, "kit")} et {pluriel(resultat.crees.options, "option")} créés
                {resultat.dejaPresents > 0 ? ` ; ${pluriel(resultat.dejaPresents, "élément déjà présent conservé", "éléments déjà présents conservés")}` : ""}.
              </DialogDescription>
            </DialogHeader>
            {resultat.notes.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-card-foreground">À compléter ou à vérifier</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-card-foreground">
                  {resultat.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button className="cursor-pointer" onClick={onFerme}>
                Terminé
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Catalogue de départ</DialogTitle>
              <DialogDescription>
                Charge les tarifs de référence du cahier des charges (annexe 14.1) pour les opérateurs choisis. Ce qui existe déjà est conservé, et tout reste modifiable ensuite.
                Vérifiez ces tarifs avec les prix actuels de chaque opérateur.
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-3">
              {chargementListe && <li className="text-sm text-muted-foreground">Chargement…</li>}
              {operateurs.map((o) => (
                <li key={o.cle} className="flex items-start gap-3">
                  <Checkbox id={`depart-${o.cle}`} className="mt-0.5" checked={choisis.includes(o.cle)} onCheckedChange={(v) => basculer(o.cle, v === true)} />
                  <Label htmlFor={`depart-${o.cle}`} className="flex flex-1 flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium text-card-foreground">{o.libelle}</span>
                    <span className="text-sm text-muted-foreground">
                      {pluriel(o.nombreFormules, "formule")}
                      {o.nombreKits > 0 ? `, ${pluriel(o.nombreKits, "kit")}` : ""}
                      {o.nombreOptions > 0 ? `, ${pluriel(o.nombreOptions, "option")}` : ""}
                    </span>
                  </Label>
                </li>
              ))}
            </ul>

            {/* zone de hauteur stable : la fenêtre est centrée, elle ne doit pas grandir (et décaler la liste) quand on coche un opérateur */}
            <div className="h-44 space-y-1.5 overflow-y-auto rounded-md border border-border p-3" aria-live="polite">
              <p className="text-sm font-medium text-card-foreground">À savoir</p>
              {notesChoisies.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-card-foreground">
                  {notesChoisies.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Les points à compléter ou à vérifier de chaque opérateur choisi s'affichent ici.</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
                Annuler
              </Button>
              <Button className="cursor-pointer" disabled={choisis.length === 0 || enCours} onClick={charger}>
                {enCours ? "Chargement…" : choisis.length === 0 ? "Choisissez un opérateur" : `Charger ${pluriel(choisis.length, "opérateur")}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
