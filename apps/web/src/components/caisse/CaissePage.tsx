import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { chargerAbonnementsAbonne, chargerCatalogue, ErreurAuthentification, reabonnerRequete, recruter } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne, Abonnement, CatalogueFamille, CatalogueKit, Formule, NouvelAbonne, ParcoursPaiementMobile } from "@/lib/types";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { RechercheAbonne } from "./RechercheAbonne";
import { CategoriesPanel } from "./CategoriesPanel";
import { GrilleArticles } from "./GrilleArticles";
import { TicketPanel, type PaiementSaisi } from "./TicketPanel";
import { EchangeMaterielDialog } from "./EchangeMaterielDialog";
import { PaiementMobileMoneyDialog } from "./PaiementMobileMoneyDialog";

interface Props {
  onNaviguer: (vue: Vue) => void;
  // pré-sélection venant du tableau de bord (réabonnement en un clic depuis une alerte, 4.4/9.3)
  abonneInitial?: Abonne;
  idFamilleInitiale?: number;
}

export function CaissePage({ onNaviguer, abonneInitial, idFamilleInitiale }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [familles, setFamilles] = useState<CatalogueFamille[]>([]);
  const [familleSelectionneeId, setFamilleSelectionneeId] = useState<number | null>(idFamilleInitiale ?? null);
  const [abonneSelectionne, setAbonneSelectionne] = useState<Abonne | NouvelAbonne | null>(abonneInitial ?? null);
  const [abonnementsAbonne, setAbonnementsAbonne] = useState<Abonnement[]>([]);
  const [formuleSelectionnee, setFormuleSelectionnee] = useState<Formule | null>(null);
  const [kitSelectionne, setKitSelectionne] = useState<CatalogueKit | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [echangeMaterielOuvert, setEchangeMaterielOuvert] = useState(false);
  const [paiementMobile, setPaiementMobile] = useState<{
    idFacture: number;
    montant: number;
    numeroTelephone: string;
    parcours: ParcoursPaiementMobile;
  } | null>(null);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  useEffect(() => {
    chargerCatalogue(token)
      .then((data) => {
        setFamilles(data);
        setFamilleSelectionneeId((id) => id ?? data[0]?.idFamille ?? null);
      })
      .catch((e) => gererErreur(e, "Impossible de charger le catalogue."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 9.2 : dès qu'un abonné existant est sélectionné, on récupère ses abonnements
  // pour savoir si l'opération à venir sera un recrutement ou un réabonnement.
  useEffect(() => {
    if (abonneSelectionne && "idAbonne" in abonneSelectionne) {
      chargerAbonnementsAbonne(token, abonneSelectionne.idAbonne)
        .then(setAbonnementsAbonne)
        .catch((e) => {
          setAbonnementsAbonne([]);
          gererErreur(e, "Impossible de charger les abonnements de ce client.");
        });
    } else {
      setAbonnementsAbonne([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abonneSelectionne, token]);

  const familleSelectionnee = useMemo(
    () => familles.find((f) => f.idFamille === familleSelectionneeId),
    [familles, familleSelectionneeId]
  );

  const formuleVersFamille = useMemo(() => {
    const carte = new Map<number, number>();
    for (const famille of familles) {
      for (const formule of famille.formules) carte.set(formule.idFormule, famille.idFamille);
    }
    return carte;
  }, [familles]);

  // 7.2/9.2 : un abonnement ACTIF ou EXPIRE déjà présent dans la famille sélectionnée
  // bascule automatiquement l'opération vers un réabonnement (résilié = nouveau recrutement).
  const abonnementARenouveler = useMemo(() => {
    if (!familleSelectionneeId) return null;
    const candidats = abonnementsAbonne.filter(
      (a) => formuleVersFamille.get(a.idFormule) === familleSelectionneeId && a.statut !== "RESILIE"
    );
    return candidats.find((a) => a.statut === "ACTIF") ?? candidats[0] ?? null;
  }, [abonnementsAbonne, familleSelectionneeId, formuleVersFamille]);

  // un kit (matériel neuf de recrutement) n'a pas sa place dans un réabonnement —
  // l'échange de matériel (panne/vol, 7.3) est une action séparée, voir plus bas
  useEffect(() => {
    if (abonnementARenouveler) setKitSelectionne(null);
  }, [abonnementARenouveler]);

  function reinitialiserTicket() {
    setFormuleSelectionnee(null);
    setKitSelectionne(null);
    setAbonneSelectionne(null);
    setAbonnementsAbonne([]);
  }

  async function valider(paiement: PaiementSaisi) {
    if (!abonneSelectionne || !formuleSelectionnee) return;
    setEnCours(true);
    try {
      const aujourdHui = new Date().toISOString().slice(0, 10);
      // 6.6 : Mobile Money n'encaisse jamais dans cet appel — la facture est
      // créée BROUILLON (montantEncaisse=0), puis le paiement est initié à
      // part sur cette facture, sans toucher au cœur du recrutement/réabonnement.
      const montantEncaisse = paiement.mode === "CASH" ? paiement.montant : 0;
      const resultat = abonnementARenouveler
        ? await reabonnerRequete(token, abonnementARenouveler.numeroAbonnement, {
            siteId: utilisateur.siteId,
            userId: utilisateur.idUser,
            aujourdHui,
            idFormule: formuleSelectionnee.idFormule,
            montantEncaisse,
          })
        : await recruter(token, {
            siteId: utilisateur.siteId,
            userId: utilisateur.idUser,
            aujourdHui,
            abonne: "idAbonne" in abonneSelectionne ? { idAbonne: abonneSelectionne.idAbonne } : abonneSelectionne,
            idFormule: formuleSelectionnee.idFormule,
            idKit: kitSelectionne?.idKit,
            montantEncaisse,
            // 6.3 : lien permanent — uniquement renseigné à la création d'un nouveau client,
            // un abonné existant hérite déjà de son apporteur côté serveur
            apporteurId: "idAbonne" in abonneSelectionne ? undefined : abonneSelectionne.apporteurId,
          });

      if (paiement.mode === "MOBILE_MONEY") {
        setPaiementMobile({
          idFacture: resultat.idFacture,
          montant: paiement.montant,
          numeroTelephone: paiement.numeroTelephone,
          parcours: paiement.parcours,
        });
        return;
      }

      const operation = abonnementARenouveler ? "Réabonnement" : "Recrutement";
      toast.success(
        resultat.statutFacture === "VALIDEE"
          ? `${operation} — abonnement n° ${resultat.numeroAbonnement} — facture encaissée.`
          : `${operation} — abonnement n° ${resultat.numeroAbonnement} — facture en attente d'encaissement.`
      );
      reinitialiserTicket();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'opération.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="caisse" onNaviguer={onNaviguer}>
        <RechercheAbonne siteId={utilisateur.siteId} abonneSelectionne={abonneSelectionne} onSelectionner={setAbonneSelectionne} />
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <CategoriesPanel
          familles={familles}
          familleSelectionnee={familleSelectionneeId}
          onSelectionner={(id) => {
            setFamilleSelectionneeId(id);
            setFormuleSelectionnee(null);
            setKitSelectionne(null);
          }}
        />
        <GrilleArticles
          famille={familleSelectionnee}
          formuleSelectionnee={formuleSelectionnee}
          idKitSelectionne={kitSelectionne?.idKit ?? null}
          idFormuleActuelle={abonnementARenouveler?.idFormule ?? null}
          masquerKits={Boolean(abonnementARenouveler)}
          onSelectionnerFormule={setFormuleSelectionnee}
          onSelectionnerKit={(idKit) => setKitSelectionne(familleSelectionnee?.kits.find((k) => k.idKit === idKit) ?? null)}
        />
        <TicketPanel
          abonneSelectionne={abonneSelectionne}
          formuleSelectionnee={formuleSelectionnee}
          kitSelectionne={kitSelectionne}
          numeroAbonnementARenouveler={abonnementARenouveler?.numeroAbonnement ?? null}
          enCours={enCours}
          onValider={valider}
          onEchangerMateriel={() => setEchangeMaterielOuvert(true)}
        />
      </div>

      <EchangeMaterielDialog
        numeroAbonnement={echangeMaterielOuvert ? (abonnementARenouveler?.numeroAbonnement ?? null) : null}
        onFerme={() => setEchangeMaterielOuvert(false)}
        onSucces={() => setEchangeMaterielOuvert(false)}
      />

      <PaiementMobileMoneyDialog
        ouvert={paiementMobile !== null}
        idFacture={paiementMobile?.idFacture ?? null}
        montant={paiementMobile?.montant ?? 0}
        numeroTelephone={paiementMobile?.numeroTelephone ?? ""}
        parcours={paiementMobile?.parcours ?? "USSD_CLIENT"}
        onFerme={() => setPaiementMobile(null)}
        onSucces={() => {
          toast.success("Paiement Mobile Money confirmé — facture encaissée.");
          setPaiementMobile(null);
          reinitialiserTicket();
        }}
      />
    </div>
  );
}
