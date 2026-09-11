import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, Unlock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  chargerClotureOuverte,
  ErreurAuthentification,
  fermerCaisseRequete,
  ouvrirCaisseRequete,
  type ClotureCaisse,
  type FermerCaisseResultat,
  type ModePaiementCloture,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const MODES: ModePaiementCloture[] = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"];
const LIBELLE_MODE: Record<ModePaiementCloture, string> = { CASH: "Comptant", CHEQUE: "Chèque", VIREMENT: "Virement", MOBILE_MONEY: "Mobile Money" };

// 13.1 : "clôture de caisse quotidienne... fond de caisse d'ouverture, comptage
// de fermeture, écart théorique/réel par mode de paiement, avec validation
// par un rôle habilité" — ouverture accessible aux rôles de vente, fermeture
// (comptage + validation de l'écart) réservée à l'encadrement.
export function ClotureCaissePanel() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;
  const peutValiderFermeture = utilisateur.role === "ADMINISTRATEUR" || utilisateur.role === "GERANT";

  const [clotureOuverte, setClotureOuverte] = useState<ClotureCaisse | null>(null);
  const [dialogOuvert, setDialogOuvert] = useState(false);
  const [fondOuverture, setFondOuverture] = useState(0);
  const [comptages, setComptages] = useState<Record<ModePaiementCloture, number>>({ CASH: 0, CHEQUE: 0, VIREMENT: 0, MOBILE_MONEY: 0 });
  const [resultat, setResultat] = useState<FermerCaisseResultat | null>(null);
  const [enCours, setEnCours] = useState(false);

  function rechargerCloture() {
    chargerClotureOuverte(token, utilisateur.siteId)
      .then(setClotureOuverte)
      .catch(() => setClotureOuverte(null));
  }

  useEffect(rechargerCloture, [token, utilisateur.siteId]);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function ouvrirDialog() {
    setFondOuverture(0);
    setComptages({ CASH: 0, CHEQUE: 0, VIREMENT: 0, MOBILE_MONEY: 0 });
    setResultat(null);
    setDialogOuvert(true);
  }

  function fermerDialog() {
    setDialogOuvert(false);
    setResultat(null);
  }

  async function validerOuverture() {
    setEnCours(true);
    try {
      const cloture = await ouvrirCaisseRequete(token, { siteId: utilisateur.siteId, userId: utilisateur.idUser, fondOuverture });
      setClotureOuverte(cloture);
      toast.success(`Caisse ouverte — fond de ${formateurFcfa.format(fondOuverture)} FCFA.`);
      setDialogOuvert(false);
    } catch (erreur) {
      gererErreur(erreur, "Impossible d'ouvrir la caisse.");
    } finally {
      setEnCours(false);
    }
  }

  async function validerFermeture() {
    if (!clotureOuverte) return;
    setEnCours(true);
    try {
      const reponse = await fermerCaisseRequete(token, clotureOuverte.idCloture, {
        userId: utilisateur.idUser,
        comptages: MODES.map((mode) => ({ mode, montantCompte: comptages[mode] })),
      });
      setResultat(reponse);
      setClotureOuverte(null);
    } catch (erreur) {
      gererErreur(erreur, "Impossible de clôturer la caisse.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <Button variant="outline" className="h-9 cursor-pointer gap-2" onClick={ouvrirDialog}>
        {clotureOuverte ? <Unlock className="size-4" /> : <Lock className="size-4" />}
        {clotureOuverte ? "Caisse ouverte" : "Caisse fermée"}
      </Button>

      <Dialog open={dialogOuvert} onOpenChange={(v) => !v && fermerDialog()}>
        <DialogContent>
          {resultat ? (
            <>
              <DialogHeader>
                <DialogTitle>Caisse clôturée</DialogTitle>
                <DialogDescription>Écart théorique/réel par mode de paiement.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {resultat.comptages.map((c) => (
                  <div key={c.mode} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{LIBELLE_MODE[c.mode]}</span>
                    <span className="tabular-nums">
                      {formateurFcfa.format(c.montantCompte)} / {formateurFcfa.format(c.montantTheorique)} FCFA
                      {" — écart "}
                      <span className={c.ecart === 0 ? "text-card-foreground" : "font-medium text-alert-j3-fg"}>
                        {c.ecart > 0 ? "+" : ""}
                        {formateurFcfa.format(c.ecart)}
                      </span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
                  <span>Écart total</span>
                  <span className={resultat.cloture.ecartTotal === 0 ? "" : "text-alert-j3-fg"}>
                    {(resultat.cloture.ecartTotal ?? 0) > 0 ? "+" : ""}
                    {formateurFcfa.format(resultat.cloture.ecartTotal ?? 0)} FCFA
                  </span>
                </div>
              </div>
              <DialogFooter>
                <Button className="cursor-pointer" onClick={fermerDialog}>
                  Terminé
                </Button>
              </DialogFooter>
            </>
          ) : clotureOuverte ? (
            <>
              <DialogHeader>
                <DialogTitle>Clôturer la caisse</DialogTitle>
                <DialogDescription>
                  Fond d'ouverture : {formateurFcfa.format(clotureOuverte.fondOuverture)} FCFA. Saisissez le comptage physique par mode de paiement.
                </DialogDescription>
              </DialogHeader>
              {!peutValiderFermeture ? (
                <p className="text-sm text-alert-j3-fg">La clôture de caisse doit être validée par un gérant ou un administrateur.</p>
              ) : (
                <div className="space-y-3">
                  {MODES.map((mode) => (
                    <div key={mode}>
                      <Label htmlFor={`comptage-${mode}`}>{LIBELLE_MODE[mode]}</Label>
                      <Input
                        id={`comptage-${mode}`}
                        type="number"
                        min={0}
                        value={comptages[mode]}
                        onChange={(e) => setComptages((c) => ({ ...c, [mode]: Number(e.target.value) }))}
                        className="mt-1 h-11 text-base tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" className="cursor-pointer" onClick={fermerDialog}>
                  Annuler
                </Button>
                {peutValiderFermeture && (
                  <Button className="cursor-pointer" disabled={enCours} onClick={validerFermeture}>
                    {enCours ? "Clôture…" : "Confirmer la clôture"}
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Ouvrir la caisse</DialogTitle>
                <DialogDescription>Fond de caisse d'ouverture — montant physiquement présent dans le tiroir au démarrage du service.</DialogDescription>
              </DialogHeader>
              <div>
                <Label htmlFor="fond-ouverture">Fond de caisse (FCFA)</Label>
                <Input
                  id="fond-ouverture"
                  type="number"
                  min={0}
                  value={fondOuverture}
                  onChange={(e) => setFondOuverture(Number(e.target.value))}
                  className="mt-1 h-11 text-base tabular-nums"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" className="cursor-pointer" onClick={fermerDialog}>
                  Annuler
                </Button>
                <Button className="cursor-pointer" disabled={enCours} onClick={validerOuverture}>
                  {enCours ? "Ouverture…" : "Ouvrir la caisse"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
