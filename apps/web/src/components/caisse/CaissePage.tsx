import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { calculerPrixKit } from "@mboapilot/shared";
import {
  chargerAbonnementsAbonne,
  chargerCatalogue,
  chargerComptesPartages,
  chargerInfosEntreprise,
  ErreurAuthentification,
  reabonnerRequete,
  recruter,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  Abonne,
  Abonnement,
  CatalogueFamille,
  CatalogueKit,
  ComptePartage,
  Formule,
  InfosEntreprise,
  NouvelAbonne,
  ParcoursPaiementMobile,
} from "@/lib/types";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { RechercheAbonne } from "./RechercheAbonne";
import { CategoriesPanel } from "./CategoriesPanel";
import { GrilleArticles } from "./GrilleArticles";
import { TicketPanel, type PaiementSaisi } from "./TicketPanel";
import { EchangeMaterielDialog } from "./EchangeMaterielDialog";
import { PaiementMobileMoneyDialog } from "./PaiementMobileMoneyDialog";
import { ChangerFormuleDialog } from "./ChangerFormuleDialog";
import { RecuVentePrintable, type LigneRecu, type RecuVente } from "./RecuVentePrintable";
import { FactureProFormaPrintable } from "./FactureProFormaPrintable";

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
  const [comptesPartages, setComptesPartages] = useState<ComptePartage[]>([]);
  const [comptePartageSelectionne, setComptePartageSelectionne] = useState<number | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [echangeMaterielOuvert, setEchangeMaterielOuvert] = useState(false);
  const [changerFormuleOuvert, setChangerFormuleOuvert] = useState(false);
  const [paiementMobile, setPaiementMobile] = useState<{
    idFacture: number;
    montant: number;
    numeroTelephone: string;
    parcours: ParcoursPaiementMobile;
    // 6.7 : base du ticket de caisse, figée au moment de l'initiation du
    // paiement (l'état de la vente en cours aura été réinitialisé lorsque la
    // confirmation Mobile Money arrivera plus tard, de façon asynchrone)
    recuBase: Omit<RecuVente, "montantEncaisse">;
  } | null>(null);
  const [infosEntreprise, setInfosEntreprise] = useState<InfosEntreprise | null>(null);
  const [recu, setRecu] = useState<RecuVente | null>(null);
  const [proFormaVisible, setProFormaVisible] = useState(false);

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

  useEffect(() => {
    chargerInfosEntreprise(token)
      .then(setInfosEntreprise)
      .catch(() => setInfosEntreprise(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 5.9 : comptes partagés streaming — chargés une fois pour le site, filtrés
  // par famille sélectionnée côté affichage (voir comptesPartagesFamille)
  useEffect(() => {
    chargerComptesPartages(token, utilisateur.siteId)
      .then(setComptesPartages)
      .catch(() => setComptesPartages([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, utilisateur.siteId]);

  // 9.2 : dès qu'un abonné existant est sélectionné, on récupère ses abonnements
  // pour savoir si l'opération à venir sera un recrutement ou un réabonnement.
  function rechargerAbonnementsAbonne() {
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
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(rechargerAbonnementsAbonne, [abonneSelectionne, token]);

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

  // 7.4 : la migration ne s'applique qu'à un abonnement ACTIF, jamais à un
  // abonnement déjà EXPIRE (seul un réabonnement est pertinent dans ce cas)
  const peutMigrerFormule = abonnementARenouveler?.statut === "ACTIF";
  const formuleActuelleAbonnement = useMemo(
    () => familleSelectionnee?.formules.find((f) => f.idFormule === abonnementARenouveler?.idFormule) ?? null,
    [familleSelectionnee, abonnementARenouveler]
  );

  // un kit (matériel neuf de recrutement) n'a pas sa place dans un réabonnement —
  // l'échange de matériel (panne/vol, 7.3) est une action séparée, voir plus bas
  useEffect(() => {
    if (abonnementARenouveler) setKitSelectionne(null);
  }, [abonnementARenouveler]);

  // 6.7 : base du ticket / pro-forma — même calcul que TicketPanel, dupliqué
  // ici pour que CaissePage puisse construire le récapitulatif imprimable
  const prixKit =
    kitSelectionne && formuleSelectionnee
      ? calculerPrixKit(kitSelectionne, { idFormule: formuleSelectionnee.idFormule, prix: formuleSelectionnee.prix })
      : 0;
  const totalTicket = (formuleSelectionnee?.prix ?? 0) + prixKit;
  const lignesTicket: LigneRecu[] = [
    ...(formuleSelectionnee ? [{ libelle: formuleSelectionnee.libelle, montant: formuleSelectionnee.prix }] : []),
    ...(kitSelectionne ? [{ libelle: kitSelectionne.libelle, montant: prixKit }] : []),
  ];

  // 5.9 : comptes actifs du service actuellement sélectionné — vide pour une
  // famille satellite classique (aucun compte partagé n'y a jamais été créé)
  const comptesPartagesFamille = useMemo(
    () => comptesPartages.filter((c) => c.idFamille === familleSelectionneeId && c.actif === 1),
    [comptesPartages, familleSelectionneeId]
  );

  useEffect(() => {
    setComptePartageSelectionne(null);
  }, [familleSelectionneeId, formuleSelectionnee]);

  function reinitialiserTicket() {
    setFormuleSelectionnee(null);
    setKitSelectionne(null);
    setAbonneSelectionne(null);
    setAbonnementsAbonne([]);
    setComptePartageSelectionne(null);
    // 5.9 : un écran vient peut-être d'être occupé — rafraîchit l'occupation affichée
    chargerComptesPartages(token, utilisateur.siteId)
      .then(setComptesPartages)
      .catch(() => {});
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
            idComptePartage: comptePartageSelectionne ?? undefined,
          });

      const operation = abonnementARenouveler ? "Réabonnement" : "Recrutement";

      if (paiement.mode === "MOBILE_MONEY") {
        setPaiementMobile({
          idFacture: resultat.idFacture,
          montant: paiement.montant,
          numeroTelephone: paiement.numeroTelephone,
          parcours: paiement.parcours,
          recuBase: {
            operation,
            numeroAbonnement: resultat.numeroAbonnement,
            lignes: lignesTicket,
            total: totalTicket,
            modePaiement: "MOBILE_MONEY",
            dateHeure: new Date().toISOString(),
          },
        });
        return;
      }

      toast.success(
        resultat.statutFacture === "VALIDEE"
          ? `${operation} — abonnement n° ${resultat.numeroAbonnement} — facture encaissée.`
          : `${operation} — abonnement n° ${resultat.numeroAbonnement} — facture en attente d'encaissement.`
      );
      setRecu({
        operation,
        numeroAbonnement: resultat.numeroAbonnement,
        lignes: lignesTicket,
        total: totalTicket,
        modePaiement: "CASH",
        montantEncaisse: paiement.montant,
        dateHeure: new Date().toISOString(),
      });
      reinitialiserTicket();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'opération.");
    } finally {
      setEnCours(false);
    }
  }

  const nomClientTicket = abonneSelectionne ? `${abonneSelectionne.prenom} ${abonneSelectionne.nom}` : "";

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="no-print">
        <AppHeader vueActive="caisse" onNaviguer={onNaviguer}>
          <RechercheAbonne siteId={utilisateur.siteId} abonneSelectionne={abonneSelectionne} onSelectionner={setAbonneSelectionne} />
        </AppHeader>
      </div>

      {recu ? (
        <RecuVentePrintable infosEntreprise={infosEntreprise} recu={recu} onNouvelleVente={() => setRecu(null)} />
      ) : proFormaVisible ? (
        <FactureProFormaPrintable
          infosEntreprise={infosEntreprise}
          nomClient={nomClientTicket}
          lignes={lignesTicket}
          total={totalTicket}
          onRetour={() => setProFormaVisible(false)}
        />
      ) : (
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
            peutMigrerFormule={peutMigrerFormule}
            comptesPartagesDisponibles={comptesPartagesFamille}
            comptePartageSelectionne={comptePartageSelectionne}
            onSelectionnerComptePartage={setComptePartageSelectionne}
            enCours={enCours}
            onValider={valider}
            onEchangerMateriel={() => setEchangeMaterielOuvert(true)}
            onChangerFormule={() => setChangerFormuleOuvert(true)}
            onImprimerProForma={() => setProFormaVisible(true)}
          />
        </div>
      )}

      <EchangeMaterielDialog
        numeroAbonnement={echangeMaterielOuvert ? (abonnementARenouveler?.numeroAbonnement ?? null) : null}
        onFerme={() => setEchangeMaterielOuvert(false)}
        onSucces={() => setEchangeMaterielOuvert(false)}
      />

      <ChangerFormuleDialog
        numeroAbonnement={changerFormuleOuvert ? (abonnementARenouveler?.numeroAbonnement ?? null) : null}
        formuleActuelle={formuleActuelleAbonnement}
        formulesFamille={familleSelectionnee?.formules ?? []}
        onFerme={() => setChangerFormuleOuvert(false)}
        onSucces={() => {
          setChangerFormuleOuvert(false);
          rechargerAbonnementsAbonne();
        }}
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
          if (paiementMobile) setRecu({ ...paiementMobile.recuBase, montantEncaisse: paiementMobile.montant });
          setPaiementMobile(null);
          reinitialiserTicket();
        }}
      />
    </div>
  );
}
