import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  actualiserTransactionMobileRequete,
  initierPaiementMobileRequete,
  ErreurAuthentification,
  ErreurReseau,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { ParcoursPaiementMobile, StatutPaiementMobile } from "@/lib/types";

interface Props {
  ouvert: boolean;
  idFacture: number | null;
  montant: number;
  numeroTelephone: string;
  parcours: ParcoursPaiementMobile;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const INTERVALLE_POLLING_MS = 1500;

const LIBELLE_STATUT: Record<StatutPaiementMobile, string> = {
  INITIEE: "Transaction initiée…",
  EN_ATTENTE: "En attente de confirmation de l'opérateur…",
  REUSSIE: "Paiement confirmé",
  ECHOUEE: "Paiement échoué",
  EXPIREE: "Délai de saisie de l'OTP dépassé",
};

// 6.6 : parcours USSD/OTP ou push marchand — la caisse interroge
// périodiquement le statut ("polling ou callback/webhook") en l'absence de
// webhook opérateur réel branché sur ce poste.
export function PaiementMobileMoneyDialog({ ouvert, idFacture, montant, numeroTelephone, parcours, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [statut, setStatut] = useState<StatutPaiementMobile | null>(null);
  const [idTransaction, setIdTransaction] = useState<number | null>(null);
  // serveur injoignable pendant l'attente : on continue d'interroger, mais le caissier n'est pas piégé dans une fenêtre sans issue
  const [connexionPerdue, setConnexionPerdue] = useState(false);
  const [initiationEchouee, setInitiationEchouee] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function arreterPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    arreterPolling();
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  useEffect(() => {
    if (!ouvert || idFacture === null) {
      setStatut(null);
      setIdTransaction(null);
      setConnexionPerdue(false);
      setInitiationEchouee(false);
      arreterPolling();
      return;
    }
    setConnexionPerdue(false);
    setInitiationEchouee(false);

    initierPaiementMobileRequete(token, { idFacture, numeroTelephone, montant, parcours })
      .then((transaction) => {
        setStatut(transaction.statut);
        setIdTransaction(transaction.idTransaction);
      })
      .catch((e) => {
        setInitiationEchouee(true);
        gererErreur(e, "Échec de l'initiation du paiement mobile.");
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, idFacture]);

  useEffect(() => {
    if (idTransaction === null || statut === "REUSSIE" || statut === "ECHOUEE" || statut === "EXPIREE") {
      arreterPolling();
      if (statut === "REUSSIE") onSucces();
      return;
    }

    intervalRef.current = setInterval(() => {
      actualiserTransactionMobileRequete(token, idTransaction)
        .then((transaction) => {
          setConnexionPerdue(false);
          setStatut(transaction.statut);
        })
        .catch((e) => {
          // une coupure passagère n'arrête pas l'interrogation : le paiement du client peut aboutir pendant ce temps
          if (e instanceof ErreurReseau) {
            setConnexionPerdue(true);
            return;
          }
          gererErreur(e, "Échec de la vérification du paiement mobile.");
        });
    }, INTERVALLE_POLLING_MS);

    return arreterPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idTransaction, statut]);

  const echoue = statut === "ECHOUEE" || statut === "EXPIREE";
  // la fenêtre ne se ferme qu'une fois le résultat connu, ou si le serveur est injoignable (sinon le caissier serait piégé)
  const fermable = echoue || connexionPerdue || initiationEchouee;

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      {/* Pas de fermeture pendant l'attente : la croix est déjà masquée, mais Échap et un clic à côté fermaient la fenêtre et laissaient une
          facture en brouillon, un stock sorti et une transaction en attente indéfiniment. On ne ferme qu'une fois le résultat connu. */}
      <DialogContent
        showCloseButton={fermable}
        onEscapeKeyDown={(e) => {
          if (!fermable && statut !== "REUSSIE") e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!fermable && statut !== "REUSSIE") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Paiement Mobile Money</DialogTitle>
          <DialogDescription>
            {numeroTelephone} — {formateurFcfa.format(montant)} FCFA
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-6 text-center">
          {statut === "REUSSIE" && <CheckCircle2 className="size-12 text-primary" aria-hidden="true" />}
          {echoue && <XCircle className="size-12 text-destructive" aria-hidden="true" />}
          {!echoue && statut !== "REUSSIE" && <Loader2 className="size-12 animate-spin text-muted-foreground" aria-hidden="true" />}

          <p className="text-sm font-medium text-card-foreground">{statut ? LIBELLE_STATUT[statut] : "Initiation…"}</p>

          {(statut === "INITIEE" || statut === "EN_ATTENTE") && (
            <p className="text-xs text-muted-foreground">
              {parcours === "USSD_CLIENT"
                ? "Le client compose le code USSD et saisit le mot de passe à usage unique reçu."
                : "Le client valide la demande de paiement reçue sur son téléphone."}
            </p>
          )}
        </div>

        {connexionPerdue && !echoue && (
          <p className="text-center text-xs text-destructive" role="alert">
            Connexion au serveur interrompue, nouvelle tentative en cours. Le paiement du client peut avoir abouti : vérifiez avant d'encaisser autrement.
          </p>
        )}

        {fermable && (
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Fermer et choisir un autre mode de paiement
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
