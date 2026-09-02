import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Printer, Users, UserSquare2 } from "lucide-react";
import { chargerFiche360, rechercherAbonnes, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { ModifierAbonneDialog } from "./ModifierAbonneDialog";
import { FusionDoublonsDialog } from "./FusionDoublonsDialog";
import type { Abonne, Fiche360 } from "@/lib/types";

interface Props {
  onNaviguer: (vue: Vue) => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });

const LIBELLE_STATUT_ABONNEMENT: Record<string, string> = { ACTIF: "Actif", EXPIRE: "Expiré", RESILIE: "Résilié" };
const VARIANTE_STATUT_ABONNEMENT: Record<string, "default" | "secondary" | "outline"> = { ACTIF: "default", EXPIRE: "secondary", RESILIE: "outline" };

// 8.1 : gestion des clients/abonnés — recherche, fiche « 360° » consolidée
// (coordonnées, historique complet toutes familles, matériel, factures,
// SAV, apporteur), modification et fusion de doublons.
export function ClientsPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<Abonne[]>([]);
  const [idSelectionne, setIdSelectionne] = useState<number | null>(null);
  const [fiche, setFiche] = useState<Fiche360 | null>(null);
  const [modifierOuvert, setModifierOuvert] = useState(false);
  const [fusionOuvert, setFusionOuvert] = useState(false);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherAbonnes(token, utilisateur.siteId, terme)
        .then(setResultats)
        .catch(() => setResultats([]));
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, token, utilisateur.siteId]);

  function rechargerFiche(idAbonne: number) {
    chargerFiche360(token, idAbonne)
      .then(setFiche)
      .catch((e) => gererErreur(e, "Impossible de charger la fiche client."));
  }

  useEffect(() => {
    if (idSelectionne !== null) rechargerFiche(idSelectionne);
    else setFiche(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSelectionne]);

  const peutFusionner = utilisateur.role === "ADMINISTRATEUR" || utilisateur.role === "GERANT";

  return (
    <div className="flex h-dvh flex-col bg-background">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>

      <div className="no-print">
        <AppHeader vueActive="clients" onNaviguer={onNaviguer} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="no-print flex w-80 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-4">
            <h1 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">Clients</h1>
            <Input
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
              placeholder="Rechercher (nom, téléphone, n° abonné)…"
              className="h-10"
            />
          </div>
          <ul className="flex-1 overflow-y-auto">
            {terme.trim() && resultats.length === 0 && <li className="p-4 text-sm text-muted-foreground">Aucun résultat.</li>}
            {!terme.trim() && <li className="p-4 text-sm text-muted-foreground">Recherchez un client pour voir sa fiche.</li>}
            {resultats.map((a) => (
              <li key={a.idAbonne}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer flex-col items-start gap-0.5 border-b border-border px-4 py-3 text-left hover:bg-muted ${idSelectionne === a.idAbonne ? "bg-muted" : ""}`}
                  onClick={() => setIdSelectionne(a.idAbonne)}
                >
                  <span className="font-medium text-foreground">{a.prenom} {a.nom}</span>
                  <span className="text-sm text-muted-foreground">n° {a.idAbonne} · {a.telephone}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!fiche && (
            <div className="no-print flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Users className="mx-auto mb-2 size-8" />
                Recherchez et sélectionnez un client pour voir sa fiche 360°.
              </div>
            </div>
          )}

          {fiche && (
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <UserSquare2 className="mt-1 size-8 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <h2 className="font-heading text-lg font-semibold text-foreground">{fiche.abonne.prenom} {fiche.abonne.nom}</h2>
                    <p className="text-sm text-muted-foreground">
                      Client n° {fiche.abonne.idAbonne} · {fiche.abonne.telephone}
                      {fiche.abonne.email ? ` · ${fiche.abonne.email}` : ""}
                    </p>
                    {fiche.abonne.adresse && <p className="text-sm text-muted-foreground">{fiche.abonne.adresse}</p>}
                    {fiche.abonne.numeroCni && <p className="text-sm text-muted-foreground">CNI : {fiche.abonne.numeroCni}</p>}
                    {fiche.apporteur && <p className="mt-1 text-sm text-muted-foreground">Apporteur d'affaires : {fiche.apporteur.nom}</p>}
                  </div>
                </div>
                <div className="no-print flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" className="cursor-pointer gap-1" onClick={() => window.print()}>
                    <Printer className="size-4" />
                    Exporter (PDF)
                  </Button>
                  <Button variant="outline" size="sm" className="cursor-pointer gap-1" onClick={() => setModifierOuvert(true)}>
                    <Pencil className="size-4" />
                    Modifier
                  </Button>
                  {peutFusionner && (
                    <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setFusionOuvert(true)}>
                      Fusionner un doublon
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Abonnements ({fiche.abonnements.length})
                </p>
                {fiche.abonnements.length === 0 && <p className="text-sm text-muted-foreground">Aucun abonnement.</p>}
                <ul className="space-y-2">
                  {fiche.abonnements.map((a) => (
                    <li key={a.numeroAbonnement}>
                      <Card className="flex-row items-center justify-between gap-3 p-3">
                        <div>
                          <p className="font-medium text-card-foreground">
                            {a.familleLibelle} — {a.formuleLibelle}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            n° {a.numeroAbonnement} · {formateurDate.format(new Date(a.dateDebut))} → {formateurDate.format(new Date(a.dateFin))}
                          </p>
                        </div>
                        <Badge variant={VARIANTE_STATUT_ABONNEMENT[a.statut]}>{LIBELLE_STATUT_ABONNEMENT[a.statut]}</Badge>
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>

              {fiche.materiels.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matériel installé</p>
                  <ul className="space-y-1 text-sm text-card-foreground">
                    {fiche.materiels.map((m) => (
                      <li key={m.idMateriel} className="flex items-center justify-between">
                        <span>
                          {m.typeMateriel}
                          {m.numeroSerie ? ` — S/N ${m.numeroSerie}` : ""} (abonnement n° {m.numeroAbonnement})
                        </span>
                        <Badge variant={m.statut === "ACTIF" ? "default" : "outline"}>{m.statut === "ACTIF" ? "Actif" : "Remplacé"}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Factures ({fiche.factures.length})
                </p>
                {fiche.factures.length === 0 && <p className="text-sm text-muted-foreground">Aucune facture.</p>}
                <ul className="space-y-1 text-sm">
                  {fiche.factures.map((f) => (
                    <li key={f.idFacture} className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Facture n° {f.idFacture} — {formateurDate.format(new Date(f.dateCreation))}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(f.montantTotal)} FCFA</span>
                        <Badge variant={f.statut === "VALIDEE" ? "default" : "secondary"}>{f.statut === "VALIDEE" ? "Validée" : "Brouillon"}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {fiche.dossiersSav.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dossiers SAV</p>
                  <ul className="space-y-1 text-sm text-card-foreground">
                    {fiche.dossiersSav.map((d) => (
                      <li key={d.idDossierSav}>
                        Dossier n° {d.idDossierSav} — {d.descriptionPanne} ({d.statut})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ModifierAbonneDialog
        abonne={modifierOuvert ? fiche?.abonne ?? null : null}
        onFerme={() => setModifierOuvert(false)}
        onSucces={() => {
          setModifierOuvert(false);
          if (idSelectionne !== null) rechargerFiche(idSelectionne);
        }}
      />

      <FusionDoublonsDialog
        abonnePrincipal={fusionOuvert ? fiche?.abonne ?? null : null}
        onFerme={() => setFusionOuvert(false)}
        onSucces={() => {
          setFusionOuvert(false);
          if (idSelectionne !== null) rechargerFiche(idSelectionne);
        }}
      />
    </div>
  );
}
