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
      arreterPolling();
      return;
    }

    initierPaiementMobileRequete(token, { idFacture, numeroTelephone, montant, parcours })
      .then((transaction) => {
        setStatut(transaction.statut);
        setIdTransaction(transaction.idTransaction);
      })
      .catch((e) => gererErreur(e, "Échec de l'initiation du paiement mobile."));

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
        .then((transaction) => setStatut(transaction.statut))
        .catch((e) => gererErreur(e, "Échec de la vérification du paiement mobile."));
    }, INTERVALLE_POLLING_MS);

    return arreterPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idTransaction, statut]);

  const echoue = statut === "ECHOUEE" || statut === "EXPIREE";

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent showCloseButton={echoue}>
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

        {echoue && (
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Fermer et choisir un autre mode de paiement
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
