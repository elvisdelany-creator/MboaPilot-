import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { calculerPrixKitHorsFormuleSecurise } from "@/lib/prix-kit";
import {
  chargerAbonnementsAbonne,
  chargerCatalogue,
  chargerComptesPartages,
  chargerInfosEntreprise,
  chargerOptions,
  chargerProduits,
  chargerUrlLogoEntreprise,
  creerVenteRequete,
  encaisserSoldeFactureRequete,
  ErreurAuthentification,
  imprimerTicketEscPosRequete,
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
  OptionCatalogue,
  ParcoursPaiementMobile,
  Produit,
} from "@/lib/types";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { RechercheAbonne } from "./RechercheAbonne";
import { CategoriesPanel } from "./CategoriesPanel";
import { CatalogueVideGuide } from "./CatalogueVideGuide";
import { GrilleArticles } from "./GrilleArticles";
import { GrilleProduits } from "./GrilleProduits";
import { TicketPanel, type PaiementSaisi } from "./TicketPanel";
import { TicketProduitsPanel, type LignePanier } from "./TicketProduitsPanel";
import { EchangeMaterielDialog } from "./EchangeMaterielDialog";
import { PaiementMobileMoneyDialog } from "./PaiementMobileMoneyDialog";
import { ChangerFormuleDialog } from "./ChangerFormuleDialog";
import { ClotureCaissePanel } from "./ClotureCaissePanel";
import { RecuVentePrintable, type LigneRecu, type RecuVente } from "./RecuVentePrintable";
import { FactureProFormaPrintable } from "./FactureProFormaPrintable";
import { classerEncaissement, creerVerrouSoumission, jourDouala, ligneAvecRemise, plafondRemiseCaissier } from "@mboapilot/shared";

interface Props {
  onNaviguer: (vue: Vue) => void;
  // ouvre Administration directement sur l'onglet Catalogue (guide d'une boutique sans catalogue)
  onOuvrirCatalogueAdministration: () => void;
  // pré-sélection venant du tableau de bord (réabonnement en un clic depuis une alerte, 4.4/9.3)
  abonneInitial?: Abonne;
  idFamilleInitiale?: number;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// une famille sans formule ni kit à vendre (toutes ses formules désactivées, ou pas encore de formule) n'a pas à occuper une
// catégorie vide à la caisse : « Disney+ » du catalogue de départ, tant que son tarif n'est pas renseigné, par exemple
function famillesVendables(familles: CatalogueFamille[]): CatalogueFamille[] {
  return familles.filter((f) => f.formules.length > 0 || f.kits.length > 0);
}

export function CaissePage({ onNaviguer, onOuvrirCatalogueAdministration, abonneInitial, idFamilleInitiale }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [familles, setFamilles] = useState<CatalogueFamille[]>([]);
  const [familleSelectionneeId, setFamilleSelectionneeId] = useState<number | null>(idFamilleInitiale ?? null);
  const [abonneSelectionne, setAbonneSelectionne] = useState<Abonne | NouvelAbonne | null>(abonneInitial ?? null);
  const [abonnementsAbonne, setAbonnementsAbonne] = useState<Abonnement[]>([]);
  const [formuleSelectionnee, setFormuleSelectionnee] = useState<Formule | null>(null);
  const [kitSelectionne, setKitSelectionne] = useState<CatalogueKit | null>(null);
  // 3.2.2, 5.4.2 : options complémentaires (ex. Option English Plus) — au
  // recrutement uniquement, comme les kits (voir masquerKits plus bas)
  const [options, setOptions] = useState<OptionCatalogue[]>([]);
  const [idsOptionsSelectionnees, setIdsOptionsSelectionnees] = useState<number[]>([]);
  // 3.2.2, 7.1 : numéro de série du décodeur/carte d'accès installé (recrutement uniquement)
  const [numeroSerie, setNumeroSerie] = useState("");
  // 6.4, 7.1 : "remise ponctuelle" sur le prix de la formule
  const [remise, setRemise] = useState(0);
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
    recuBase: Omit<RecuVente, "montantEncaisse" | "statutFacture">;
  } | null>(null);
  // 6.6 : vente dont le paiement Mobile Money a échoué ou expiré. Sa facture existe déjà (BROUILLON) et son stock est déjà sorti :
  // « choisir un autre mode de paiement » doit l'encaisser, pas recréer une seconde vente (deux factures, deux sorties de stock)
  const [venteAReprendre, setVenteAReprendre] = useState<NonNullable<typeof paiementMobile> | null>(null);
  useEffect(() => {
    if (paiementMobile) setVenteAReprendre(paiementMobile);
  }, [paiementMobile]);
  const [infosEntreprise, setInfosEntreprise] = useState<InfosEntreprise | null>(null);
  // 3.2.1, 13.2 : logo affiché en en-tête du ticket de caisse et de la facture pro-forma
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [recu, setRecu] = useState<RecuVente | null>(null);
  const [proFormaVisible, setProFormaVisible] = useState(false);

  // 5.2, 5.3, 8.5 : vente de produits/services hors abonnement — panier
  // indépendant du ticket formule/kit, activé depuis la catégorie dédiée
  const [modeProduits, setModeProduits] = useState(false);
  const [produits, setProduits] = useState<Produit[]>([]);
  // « catalogue vide » ne se dit qu'une fois les deux chargements terminés avec succès (jamais pendant le chargement)
  const [famillesChargees, setFamillesChargees] = useState(false);
  const [produitsCharges, setProduitsCharges] = useState(false);
  const [panierProduits, setPanierProduits] = useState<LignePanier[]>([]);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    // un prix a changé depuis l'affichage : le serveur a refusé avant tout encaissement ; on recharge les prix, le ticket en
    // cours garde ses lignes mais prend les nouveaux prix, et le caissier revoit le total avec le client avant de valider
    if (erreur instanceof Error && erreur.message.startsWith("Le prix a changé")) {
      toast.error("Le prix a changé depuis l'affichage : les prix de la caisse viennent d'être mis à jour. Vérifiez le nouveau total avec le client, puis validez à nouveau.");
      rafraichirPrix();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  async function rafraichirPrix() {
    try {
      const [nouvellesFamilles, nouveauxProduits] = await Promise.all([chargerCatalogue(token), chargerProduits(token, utilisateur.siteId)]);
      setFamilles(famillesVendables(nouvellesFamilles));
      const produitsVente = nouveauxProduits.filter((p) => p.type === "BIEN" || p.type === "SERVICE");
      setProduits(produitsVente);
      setPanierProduits((panier) => panier.map((l) => ({ ...l, produit: produitsVente.find((p) => p.idProduit === l.produit.idProduit) ?? l.produit })));
      const formules = nouvellesFamilles.flatMap((f) => f.formules);
      const kits = nouvellesFamilles.flatMap((f) => f.kits);
      setFormuleSelectionnee((f) => (f ? formules.find((x) => x.idFormule === f.idFormule) ?? f : f));
      setKitSelectionne((k) => (k ? kits.find((x) => x.idKit === k.idKit) ?? k : k));
    } catch {
      // la panne réseau est déjà signalée par les autres chargements ; le prochain essai de validation redemandera les prix
    }
  }

  useEffect(() => {
    chargerCatalogue(token)
      .then((data) => {
        const vendables = famillesVendables(data);
        setFamilles(vendables);
        setFamillesChargees(true);
        setFamilleSelectionneeId((id) => id ?? vendables[0]?.idFamille ?? null);
      })
      .catch((e) => gererErreur(e, "Impossible de charger le catalogue."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    chargerInfosEntreprise(token)
      .then(setInfosEntreprise)
      .catch(() => setInfosEntreprise(null));
    chargerUrlLogoEntreprise(token).then(setLogoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 11.4, 6.7 : imprime le ticket sur l'imprimante ESC/POS du site dès son
  // édition, en plus du bouton "Imprimer le ticket" (impression navigateur,
  // toujours disponible) — silencieux si aucune imprimante n'est configurée
  // (repli attendu), un échec réseau ne bloque jamais la vente déjà encaissée.
  useEffect(() => {
    // 6.4 : jamais d'impression d'une facture BROUILLON (aucun encaissement)
    if (!recu || recu.statutFacture !== "VALIDEE") return;
    imprimerTicketEscPosRequete(token, {
      operation: recu.operation,
      numeroAbonnement: recu.numeroAbonnement,
      lignes: recu.lignes,
      total: recu.total,
      montantTaxe: recu.montantTaxe,
      modePaiement: recu.modePaiement,
      montantEncaisse: recu.montantEncaisse,
      dateHeure: recu.dateHeure,
      idFacture: recu.idFacture,
    }).catch(() => toast.error("Échec de l'impression réseau — utilisez le bouton « Imprimer le ticket »."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recu]);

  // 3.2.2, 5.4.2 : options complémentaires, filtrées par compatibilité avec
  // la formule sélectionnée côté TicketPanel
  useEffect(() => {
    chargerOptions(token)
      .then(setOptions)
      .catch(() => setOptions([]));
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

  // 5.2, 5.3 : catalogue produits/services du site, pour la vente rapide hors abonnement
  useEffect(() => {
    chargerProduits(token, utilisateur.siteId)
      .then((data) => {
        setProduits(data.filter((p) => p.type === "BIEN" || p.type === "SERVICE"));
        setProduitsCharges(true);
      })
      .catch((e) => gererErreur(e, "Impossible de charger le catalogue de produits/services."));
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

  // 3.2.2, 7.1 : le numéro de série est propre au kit sélectionné — repart de
  // zéro dès qu'on change de kit (ou qu'on le retire)
  useEffect(() => {
    setNumeroSerie("");
  }, [kitSelectionne?.idKit]);

  // 6.4 : la remise porte sur une formule précise — repart de zéro dès qu'on
  // change de formule ou d'opération, pour ne jamais la reporter par erreur
  useEffect(() => {
    setRemise(0);
  }, [formuleSelectionnee?.idFormule, abonnementARenouveler]);

  // 3.2.2, 5.4.2 : options — au recrutement uniquement (comme les kits) ;
  // repart de zéro dès qu'on change de formule, certaines options pouvant
  // ne plus être compatibles
  useEffect(() => {
    setIdsOptionsSelectionnees([]);
  }, [formuleSelectionnee?.idFormule, abonnementARenouveler]);

  // 3.2.2, 5.4.2, 7.2 : options compatibles avec la formule sélectionnée
  // (recrutement comme réabonnement — "ajuster ses options" au renouvellement,
  // 7.2), avec leur tarif différencié éventuel
  const optionsCompatibles = useMemo(() => {
    if (!formuleSelectionnee) return [];
    return options
      .map((o) => ({ option: o, compat: o.formulesCompatibles.find((c) => c.idFormule === formuleSelectionnee.idFormule) }))
      .filter((o): o is { option: OptionCatalogue; compat: { idFormule: number; prixSurcharge: number | null } } => o.compat !== undefined)
      .map(({ option, compat }) => ({ ...option, prixApplique: compat.prixSurcharge ?? option.prix }));
  }, [options, formuleSelectionnee]);

  const optionsSelectionnees = optionsCompatibles.filter((o) => idsOptionsSelectionnees.includes(o.idOption));
  const prixOptions = optionsSelectionnees.reduce((total, o) => total + o.prixApplique, 0);

  // 6.4, 2.5.1 : un caissier ne remise pas au-delà d'un pourcentage du prix de la ligne (réglable). Le serveur refuse au-delà ;
  // la caisse montre la limite dès la saisie, plutôt que de la révéler par un refus au moment de valider devant le client.
  // Les autres rôles n'ont pas de limite (jusqu'au prix de la ligne). Avant le chargement des réglages, seul le serveur fait foi.
  const plafondRemisePourcent = utilisateur.role === "CAISSIER" ? (infosEntreprise?.entreprise.plafondRemiseCaissierPourcent ?? null) : null;
  function plafondRemise(prixBase: number): number {
    return plafondRemisePourcent === null ? prixBase : plafondRemiseCaissier(prixBase, plafondRemisePourcent);
  }

  // 6.7 : base du ticket / pro-forma — même calcul que TicketPanel, dupliqué
  // ici pour que CaissePage puisse construire le récapitulatif imprimable
  const prixKitHorsFormule =
    kitSelectionne && formuleSelectionnee
      ? calculerPrixKitHorsFormuleSecurise(kitSelectionne, { idFormule: formuleSelectionnee.idFormule, prix: formuleSelectionnee.prix })
      : 0;
  const remiseEffective = formuleSelectionnee ? Math.min(remise, plafondRemise(formuleSelectionnee.prix)) : 0;
  const totalTicket = (formuleSelectionnee?.prix ?? 0) - remiseEffective + (prixKitHorsFormule ?? 0) + prixOptions;
  const lignesTicket: LigneRecu[] = [
    // prix catalogue puis ligne « Remise » : les lignes du reçu totalisent le total, et le client voit sa remise
    ...(formuleSelectionnee ? ligneAvecRemise(formuleSelectionnee.libelle, formuleSelectionnee.prix, remiseEffective) : []),
    ...(kitSelectionne ? [{ libelle: `${kitSelectionne.libelle} — matériel`, montant: prixKitHorsFormule ?? 0 }] : []),
    ...optionsSelectionnees.map((o) => ({ libelle: o.libelle, montant: o.prixApplique })),
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
    setVenteAReprendre(null);
    setFormuleSelectionnee(null);
    setKitSelectionne(null);
    setIdsOptionsSelectionnees([]);
    setRemise(0);
    setAbonneSelectionne(null);
    setAbonnementsAbonne([]);
    setComptePartageSelectionne(null);
    // 5.9 : un écran vient peut-être d'être occupé — rafraîchit l'occupation affichée
    chargerComptesPartages(token, utilisateur.siteId)
      .then(setComptesPartages)
      .catch(() => {});
  }

  // 5.2, 5.3 : panier de produits/services — un clic ajoute une unité,
  // tolérant aux erreurs de saisie (persona Caissier, 2.5.1) via +/- et retrait
  function ajouterProduitAuPanier(produit: Produit) {
    setPanierProduits((panier) => {
      const existant = panier.find((l) => l.produit.idProduit === produit.idProduit);
      if (existant) return panier.map((l) => (l.produit.idProduit === produit.idProduit ? { ...l, quantite: l.quantite + 1 } : l));
      return [...panier, { produit, quantite: 1, remise: 0 }];
    });
  }

  // 6.4 : "remise ponctuelle" par ligne, plafonnée à la limite du rôle (au plus le prix catalogue de la ligne)
  function modifierRemiseProduit(idProduit: number, remise: number) {
    setPanierProduits((panier) =>
      panier.map((l) => (l.produit.idProduit === idProduit ? { ...l, remise: Math.max(0, Math.min(remise, plafondRemise(l.produit.prixVente * l.quantite))) } : l))
    );
  }

  function incrementerProduit(idProduit: number) {
    setPanierProduits((panier) => panier.map((l) => (l.produit.idProduit === idProduit ? { ...l, quantite: l.quantite + 1 } : l)));
  }

  function decrementerProduit(idProduit: number) {
    setPanierProduits((panier) =>
      panier.flatMap((l) => {
        if (l.produit.idProduit !== idProduit) return [l];
        if (l.quantite <= 1) return [];
        // la base de la ligne baisse : la remise déjà saisie ne doit pas dépasser le nouveau plafond
        const quantite = l.quantite - 1;
        return [{ ...l, quantite, remise: Math.min(l.remise, plafondRemise(l.produit.prixVente * quantite)) }];
      })
    );
  }

  function retirerProduit(idProduit: number) {
    setPanierProduits((panier) => panier.filter((l) => l.produit.idProduit !== idProduit));
  }

  function reinitialiserTicketProduits() {
    setVenteAReprendre(null);
    setPanierProduits([]);
    setAbonneSelectionne(null);
  }

  const lignesTicketProduits: LigneRecu[] = panierProduits.flatMap((l) =>
    ligneAvecRemise(l.quantite > 1 ? `${l.produit.libelle} × ${l.quantite}` : l.produit.libelle, l.produit.prixVente * l.quantite, l.remise, `Remise — ${l.produit.libelle}`)
  );
  const totalTicketProduits = panierProduits.reduce((somme, l) => somme + l.produit.prixVente * l.quantite - l.remise, 0);

  // la vente à reprendre ne vaut que pour le MÊME ticket : si le caissier l'a modifié depuis, une nouvelle vente s'ouvre et l'ancienne
  // facture reste à régler (il en est averti, elle n'est pas perdue en silence)
  function venteAReprendrePourCeTicket(total: number, lignes: LigneRecu[]) {
    if (!venteAReprendre) return null;
    if (venteAReprendre.recuBase.total === total && JSON.stringify(venteAReprendre.recuBase.lignes) === JSON.stringify(lignes)) return venteAReprendre;
    toast.warning(`La vente précédente (facture n° ${venteAReprendre.idFacture}, ${formateurFcfa.format(venteAReprendre.recuBase.total)} FCFA) n'a pas été encaissée : elle reste à régler.`);
    setVenteAReprendre(null);
    return null;
  }

  async function reprendreEncaissement(reprise: NonNullable<typeof paiementMobile>, paiement: PaiementSaisi) {
    if (paiement.mode === "MOBILE_MONEY") {
      // nouvelle tentative sur la même facture
      setPaiementMobile({ ...reprise, montant: paiement.montant, numeroTelephone: paiement.numeroTelephone, parcours: paiement.parcours });
      return;
    }
    await encaisserSoldeFactureRequete(token, reprise.idFacture, {
      userId: utilisateur.idUser,
      montant: paiement.montant,
      modePaiement: paiement.mode,
      banque: paiement.mode === "CHEQUE" || paiement.mode === "VIREMENT" ? paiement.banque : undefined,
      numeroCheque: paiement.mode === "CHEQUE" ? paiement.numeroCheque : undefined,
      titulaireCheque: paiement.mode === "CHEQUE" ? paiement.titulaireCheque : undefined,
      dateCheque: paiement.mode === "CHEQUE" ? paiement.dateCheque : undefined,
      referenceVirement: paiement.mode === "VIREMENT" ? paiement.referenceVirement : undefined,
    });
    toast.success(`${reprise.recuBase.operation === "Vente" ? "Vente" : reprise.recuBase.operation} encaissée — facture n° ${reprise.idFacture}.`);
    setRecu({ ...reprise.recuBase, modePaiement: paiement.mode, montantEncaisse: paiement.montant, dateHeure: new Date().toISOString(), statutFacture: "VALIDEE" });
    if (reprise.recuBase.operation === "Vente") {
      reinitialiserTicketProduits();
      chargerProduits(token, utilisateur.siteId)
        .then((data) => setProduits(data.filter((p) => p.type === "BIEN" || p.type === "SERVICE")))
        .catch(() => {});
    } else {
      reinitialiserTicket();
    }
  }

  // verrou synchrone : l'état « en cours » ne se met à jour qu'au prochain rendu, et des déclenchements qui arrivent avant lui
  // (double clic, Entrée répétée) encaissaient chacun la vente une fois de plus
  const [executerUneFois] = useState(creerVerrouSoumission);
  const validerVenteProduits = (paiement: PaiementSaisi) => executerUneFois(() => validerVenteProduitsSansVerrou(paiement));
  const valider = (paiement: PaiementSaisi) => executerUneFois(() => validerSansVerrou(paiement));

  async function validerVenteProduitsSansVerrou(paiement: PaiementSaisi) {
    if (panierProduits.length === 0) return;
    const reprise = venteAReprendrePourCeTicket(totalTicketProduits, lignesTicketProduits);
    setEnCours(true);
    try {
      if (reprise) {
        await reprendreEncaissement(reprise, paiement);
        return;
      }
      // 6.5 : chèque et virement s'encaissent immédiatement, comme le comptant
      // (seul Mobile Money n'encaisse rien à cet appel, voir plus bas)
      const montantEncaisse = paiement.mode === "MOBILE_MONEY" ? 0 : paiement.montant;
      const resultat = await creerVenteRequete(token, {
        siteId: utilisateur.siteId,
        userId: utilisateur.idUser,
        idAbonne: abonneSelectionne && "idAbonne" in abonneSelectionne ? abonneSelectionne.idAbonne : undefined,
        nouvelAbonne: abonneSelectionne && !("idAbonne" in abonneSelectionne) ? abonneSelectionne : undefined,
        lignes: panierProduits.map((l) => ({ idProduit: l.produit.idProduit, quantite: l.quantite, remise: l.remise || undefined })),
        montantEncaisse,
        totalAttendu: totalTicketProduits,
        modePaiement: paiement.mode === "MOBILE_MONEY" ? undefined : paiement.mode,
        banque: paiement.mode === "CHEQUE" || paiement.mode === "VIREMENT" ? paiement.banque : undefined,
        numeroCheque: paiement.mode === "CHEQUE" ? paiement.numeroCheque : undefined,
        titulaireCheque: paiement.mode === "CHEQUE" ? paiement.titulaireCheque : undefined,
        dateCheque: paiement.mode === "CHEQUE" ? paiement.dateCheque : undefined,
        referenceVirement: paiement.mode === "VIREMENT" ? paiement.referenceVirement : undefined,
      });

      if (paiement.mode === "MOBILE_MONEY") {
        setPaiementMobile({
          idFacture: resultat.idFacture,
          montant: paiement.montant,
          numeroTelephone: paiement.numeroTelephone,
          parcours: paiement.parcours,
          recuBase: {
            operation: "Vente",
            numeroAbonnement: null,
            lignes: lignesTicketProduits,
            total: totalTicketProduits,
            montantTaxe: resultat.montantTaxe,
            modePaiement: "MOBILE_MONEY",
            dateHeure: new Date().toISOString(),
            idFacture: resultat.idFacture,
            jetonVerification: resultat.jetonVerification,
          },
        });
        return;
      }

      const etatVente = classerEncaissement(totalTicketProduits, paiement.montant, resultat.statutFacture);
      toast.success(
        etatVente.type === "TOTAL"
          ? "Vente encaissée."
          : etatVente.type === "PARTIEL"
            ? `Vente enregistrée — acompte de ${formateurFcfa.format(etatVente.encaisse)} FCFA encaissé, solde restant dû ${formateurFcfa.format(etatVente.reste)} FCFA.`
            : "Vente enregistrée — en attente d'encaissement."
      );
      setRecu({
        operation: "Vente",
        numeroAbonnement: null,
        lignes: lignesTicketProduits,
        total: totalTicketProduits,
        montantTaxe: resultat.montantTaxe,
        modePaiement: paiement.mode,
        montantEncaisse: paiement.montant,
        dateHeure: new Date().toISOString(),
        idFacture: resultat.idFacture,
        jetonVerification: resultat.jetonVerification,
        statutFacture: resultat.statutFacture,
      });
      reinitialiserTicketProduits();
      // 5.2 : le stock vient peut-être d'être décrémenté — rafraîchit les quantités affichées
      chargerProduits(token, utilisateur.siteId)
        .then((data) => setProduits(data.filter((p) => p.type === "BIEN" || p.type === "SERVICE")))
        .catch(() => {});
    } catch (erreur) {
      gererErreur(erreur, "Échec de la vente.");
    } finally {
      setEnCours(false);
    }
  }

  async function validerSansVerrou(paiement: PaiementSaisi) {
    if (!abonneSelectionne || !formuleSelectionnee) return;
    const reprise = venteAReprendrePourCeTicket(totalTicket, lignesTicket);
    setEnCours(true);
    try {
      if (reprise) {
        await reprendreEncaissement(reprise, paiement);
        return;
      }
      const aujourdHui = jourDouala();
      // 6.6 : Mobile Money n'encaisse jamais dans cet appel — la facture est
      // créée BROUILLON (montantEncaisse=0), puis le paiement est initié à
      // part sur cette facture, sans toucher au cœur du recrutement/réabonnement.
      // 6.5 : chèque et virement s'encaissent immédiatement, comme le comptant.
      const montantEncaisse = paiement.mode === "MOBILE_MONEY" ? 0 : paiement.montant;
      const detailsPaiement = {
        modePaiement: paiement.mode === "MOBILE_MONEY" ? undefined : paiement.mode,
        banque: paiement.mode === "CHEQUE" || paiement.mode === "VIREMENT" ? paiement.banque : undefined,
        numeroCheque: paiement.mode === "CHEQUE" ? paiement.numeroCheque : undefined,
        titulaireCheque: paiement.mode === "CHEQUE" ? paiement.titulaireCheque : undefined,
        dateCheque: paiement.mode === "CHEQUE" ? paiement.dateCheque : undefined,
        referenceVirement: paiement.mode === "VIREMENT" ? paiement.referenceVirement : undefined,
      };
      const resultat = abonnementARenouveler
        ? await reabonnerRequete(token, abonnementARenouveler.numeroAbonnement, {
            siteId: utilisateur.siteId,
            userId: utilisateur.idUser,
            aujourdHui,
            idFormule: formuleSelectionnee.idFormule,
            idsOptions: idsOptionsSelectionnees.length > 0 ? idsOptionsSelectionnees : undefined,
            montantEncaisse,
            totalAttendu: totalTicket,
            remise: remiseEffective || undefined,
            ...detailsPaiement,
          })
        : await recruter(token, {
            siteId: utilisateur.siteId,
            userId: utilisateur.idUser,
            aujourdHui,
            abonne: "idAbonne" in abonneSelectionne ? { idAbonne: abonneSelectionne.idAbonne } : abonneSelectionne,
            idFormule: formuleSelectionnee.idFormule,
            idKit: kitSelectionne?.idKit,
            numeroSerie: kitSelectionne && numeroSerie.trim() ? numeroSerie.trim() : undefined,
            idsOptions: idsOptionsSelectionnees.length > 0 ? idsOptionsSelectionnees : undefined,
            montantEncaisse,
            totalAttendu: totalTicket,
            // 6.3 : lien permanent — uniquement renseigné à la création d'un nouveau client,
            // un abonné existant hérite déjà de son apporteur côté serveur
            apporteurId: "idAbonne" in abonneSelectionne ? undefined : abonneSelectionne.apporteurId,
            idComptePartage: comptePartageSelectionne ?? undefined,
            remise: remiseEffective || undefined,
            ...detailsPaiement,
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
            montantTaxe: resultat.montantTaxe,
            modePaiement: "MOBILE_MONEY",
            dateHeure: new Date().toISOString(),
            idFacture: resultat.idFacture,
            jetonVerification: resultat.jetonVerification,
          },
        });
        return;
      }

      const etat = classerEncaissement(totalTicket, paiement.montant, resultat.statutFacture);
      const debut = `${operation} — abonnement n° ${resultat.numeroAbonnement}`;
      toast.success(
        etat.type === "TOTAL"
          ? `${debut} — facture encaissée.`
          : etat.type === "PARTIEL"
            ? `${debut} — acompte de ${formateurFcfa.format(etat.encaisse)} FCFA encaissé, solde restant dû ${formateurFcfa.format(etat.reste)} FCFA.`
            : `${debut} — facture en attente d'encaissement.`
      );
      setRecu({
        operation,
        numeroAbonnement: resultat.numeroAbonnement,
        lignes: lignesTicket,
        total: totalTicket,
        montantTaxe: resultat.montantTaxe,
        modePaiement: paiement.mode,
        montantEncaisse: paiement.montant,
        dateHeure: new Date().toISOString(),
        idFacture: resultat.idFacture,
        jetonVerification: resultat.jetonVerification,
        statutFacture: resultat.statutFacture,
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
          <ClotureCaissePanel />
        </AppHeader>
      </div>

      {recu ? (
        <RecuVentePrintable infosEntreprise={infosEntreprise} logoUrl={logoUrl} recu={recu} onNouvelleVente={() => setRecu(null)} />
      ) : proFormaVisible ? (
        <FactureProFormaPrintable
          infosEntreprise={infosEntreprise}
          logoUrl={logoUrl}
          nomClient={nomClientTicket}
          lignes={modeProduits ? lignesTicketProduits : lignesTicket}
          total={modeProduits ? totalTicketProduits : totalTicket}
          onRetour={() => setProFormaVisible(false)}
        />
      ) : famillesChargees && produitsCharges && familles.length === 0 && produits.length === 0 ? (
        <CatalogueVideGuide role={utilisateur.role} onNaviguer={onNaviguer} onOuvrirCatalogueAdministration={onOuvrirCatalogueAdministration} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <CategoriesPanel
            familles={familles}
            familleSelectionnee={familleSelectionneeId}
            modeProduits={modeProduits}
            onSelectionner={(id) => {
              setModeProduits(false);
              setFamilleSelectionneeId(id);
              setFormuleSelectionnee(null);
              setKitSelectionne(null);
            }}
            onSelectionnerProduits={() => {
              setModeProduits(true);
              setFormuleSelectionnee(null);
              setKitSelectionne(null);
            }}
          />
          {modeProduits ? (
            <>
              <GrilleProduits produits={produits} onAjouter={ajouterProduitAuPanier} />
              <TicketProduitsPanel
                panier={panierProduits}
                onIncrementer={incrementerProduit}
                onDecrementer={decrementerProduit}
                onRetirer={retirerProduit}
                onModifierRemise={modifierRemiseProduit}
                plafondRemise={plafondRemise}
                plafondRemisePourcent={plafondRemisePourcent}
                enCours={enCours}
                onValider={validerVenteProduits}
                onImprimerProForma={() => setProFormaVisible(true)}
              />
            </>
          ) : (
            <>
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
                numeroSerie={numeroSerie}
                onChangerNumeroSerie={setNumeroSerie}
                optionsCompatibles={optionsCompatibles}
                idsOptionsSelectionnees={idsOptionsSelectionnees}
                onChangerOptionsSelectionnees={setIdsOptionsSelectionnees}
                numeroAbonnementARenouveler={abonnementARenouveler?.numeroAbonnement ?? null}
                peutMigrerFormule={peutMigrerFormule}
                comptesPartagesDisponibles={comptesPartagesFamille}
                comptePartageSelectionne={comptePartageSelectionne}
                onSelectionnerComptePartage={setComptePartageSelectionne}
                remise={remiseEffective}
                onChangerRemise={setRemise}
                plafondRemise={plafondRemise}
                plafondRemisePourcent={plafondRemisePourcent}
                enCours={enCours}
                onValider={valider}
                onEchangerMateriel={() => setEchangeMaterielOuvert(true)}
                onChangerFormule={() => setChangerFormuleOuvert(true)}
                onImprimerProForma={() => setProFormaVisible(true)}
              />
            </>
          )}
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
          setVenteAReprendre(null);
          if (paiementMobile) setRecu({ ...paiementMobile.recuBase, montantEncaisse: paiementMobile.montant, statutFacture: "VALIDEE" });
          const venteProduits = paiementMobile?.recuBase.operation === "Vente";
          setPaiementMobile(null);
          if (venteProduits) {
            reinitialiserTicketProduits();
            chargerProduits(token, utilisateur.siteId)
              .then((data) => setProduits(data.filter((p) => p.type === "BIEN" || p.type === "SERVICE")))
              .catch(() => {});
          } else {
            reinitialiserTicket();
          }
        }}
      />
    </div>
  );
}
