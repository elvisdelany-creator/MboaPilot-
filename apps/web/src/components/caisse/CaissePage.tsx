import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { chargerAbonnementsAbonne, chargerCatalogue, ErreurAuthentification, reabonnerRequete, recruter } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne, Abonnement, CatalogueFamille, CatalogueKit, Formule, NouvelAbonne } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { RechercheAbonne } from "./RechercheAbonne";
import { CategoriesPanel } from "./CategoriesPanel";
import { GrilleArticles } from "./GrilleArticles";
import { TicketPanel } from "./TicketPanel";

const LIBELLES_ROLES: Record<string, string> = {
  ADMINISTRATEUR: "Administrateur",
  GERANT: "Gérant",
  CAISSIER: "Caissier",
  TECHNICIEN_SAV: "Technicien SAV",
  COMPTABLE: "Comptable",
  APPORTEUR: "Apporteur d'affaires",
};

export function CaissePage() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [familles, setFamilles] = useState<CatalogueFamille[]>([]);
  const [familleSelectionneeId, setFamilleSelectionneeId] = useState<number | null>(null);
  const [abonneSelectionne, setAbonneSelectionne] = useState<Abonne | NouvelAbonne | null>(null);
  const [abonnementsAbonne, setAbonnementsAbonne] = useState<Abonnement[]>([]);
  const [formuleSelectionnee, setFormuleSelectionnee] = useState<Formule | null>(null);
  const [kitSelectionne, setKitSelectionne] = useState<CatalogueKit | null>(null);
  const [enCours, setEnCours] = useState(false);

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

  // un kit (matériel) n'a pas sa place dans un réabonnement — l'échange de matériel
  // relève d'un autre scénario (7.3), non couvert par cet écran
  useEffect(() => {
    if (abonnementARenouveler) setKitSelectionne(null);
  }, [abonnementARenouveler]);

  function reinitialiserTicket() {
    setFormuleSelectionnee(null);
    setKitSelectionne(null);
    setAbonneSelectionne(null);
    setAbonnementsAbonne([]);
  }

  async function valider(montantEncaisse: number) {
    if (!abonneSelectionne || !formuleSelectionnee) return;
    setEnCours(true);
    try {
      const aujourdHui = new Date().toISOString().slice(0, 10);
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
          });

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
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-4 py-3">
        <RechercheAbonne siteId={utilisateur.siteId} abonneSelectionne={abonneSelectionne} onSelectionner={setAbonneSelectionne} />
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {utilisateur.prenom} {utilisateur.nom} · {LIBELLES_ROLES[utilisateur.role] ?? utilisateur.role}
          </span>
          <Button variant="ghost" size="icon" className="size-9 cursor-pointer" aria-label="Se déconnecter" onClick={deconnecter}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

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
        />
      </div>
    </div>
  );
}
