import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  chargerCatalogue,
  chargerFamilles,
  chargerFormulesFamille,
  chargerKits,
  chargerOptions,
  creerFamilleRequete,
  definirPrixDecodeurKitRequete,
  delierOptionFormuleRequete,
  ErreurAuthentification,
  lierOptionFormuleRequete,
  modifierFormuleRequete,
  supprimerPrixDecodeurKitRequete,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { NouvelleFormuleDialog } from "./NouvelleFormuleDialog";
import { NouvelleOptionDialog } from "./NouvelleOptionDialog";
import { NouveauKitDialog } from "./NouveauKitDialog";
import type { CatalogueFamille, Famille, Formule, KitBrut, OptionCatalogue } from "@/lib/types";

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const LIBELLES_MODE_DUREE: Record<"STRICT_30J" | "MOIS_CIVIL", string> = { STRICT_30J: "30 jours stricts", MOIS_CIVIL: "Mois civil" };
const LIBELLES_REGLE_PRIX: Record<KitBrut["reglePrix"], string> = {
  PRIX_FIXE: "Prix fixe",
  PRIX_DECODEUR_VARIABLE_SELON_FORMULE: "Décodeur variable selon formule",
  PRIX_KIT_FIXE_PAR_DIFFERENTIEL: "Fixe par différentiel",
};

// 8.8 : back-office catalogue — familles, formules (prix, rang, mode de
// calcul de validité 4.1), kits (règles de prix dynamique, 5.1.1) et
// options/compléments, sans intervention développeur.
export function CatalogueTab() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [familles, setFamilles] = useState<Famille[]>([]);
  const [formulesParFamille, setFormulesParFamille] = useState<Record<number, Formule[]>>({});
  const [kitsParFamille, setKitsParFamille] = useState<Record<number, KitBrut[]>>({});
  const [catalogueVente, setCatalogueVente] = useState<CatalogueFamille[]>([]);
  const [options, setOptions] = useState<OptionCatalogue[]>([]);
  const [nouvelleFamille, setNouvelleFamille] = useState("");
  const [enCoursFamille, setEnCoursFamille] = useState(false);
  const [formuleDialogFamilleId, setFormuleDialogFamilleId] = useState<number | null>(null);
  const [formuleEnEdition, setFormuleEnEdition] = useState<Formule | null>(null);
  const [kitDialogFamilleId, setKitDialogFamilleId] = useState<number | null>(null);
  const [kitEnEdition, setKitEnEdition] = useState<KitBrut | null>(null);
  const [optionDialogOuvert, setOptionDialogOuvert] = useState(false);
  const [optionEnEdition, setOptionEnEdition] = useState<OptionCatalogue | null>(null);
  const [liaisonFormuleId, setLiaisonFormuleId] = useState<Record<number, string>>({});
  const [liaisonPrixSurcharge, setLiaisonPrixSurcharge] = useState<Record<number, string>>({});
  const [grilleFormuleId, setGrilleFormuleId] = useState<Record<number, string>>({});
  const [grillePrix, setGrillePrix] = useState<Record<number, string>>({});

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerFamilles() {
    chargerFamilles(token)
      .then((liste) => {
        setFamilles(liste);
        Promise.all(liste.map((f) => chargerFormulesFamille(token, f.idFamille).then((formules) => [f.idFamille, formules] as const)))
          .then((paires) => setFormulesParFamille(Object.fromEntries(paires)))
          .catch(() => {});
        Promise.all(liste.map((f) => chargerKits(token, f.idFamille).then((kits) => [f.idFamille, kits] as const)))
          .then((paires) => setKitsParFamille(Object.fromEntries(paires)))
          .catch(() => {});
      })
      .catch((e) => gererErreur(e, "Impossible de charger les familles."));
  }

  function rechargerCatalogueVente() {
    chargerCatalogue(token)
      .then(setCatalogueVente)
      .catch(() => {});
  }

  function rechargerOptions() {
    chargerOptions(token)
      .then(setOptions)
      .catch((e) => gererErreur(e, "Impossible de charger les options."));
  }

  useEffect(rechargerFamilles, [token]);
  useEffect(rechargerCatalogueVente, [token]);
  useEffect(rechargerOptions, [token]);

  async function creerFamille() {
    if (!nouvelleFamille.trim()) return;
    setEnCoursFamille(true);
    try {
      await creerFamilleRequete(token, { libelle: nouvelleFamille.trim() });
      toast.success(`Famille « ${nouvelleFamille.trim()} » créée.`);
      setNouvelleFamille("");
      rechargerFamilles();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la création de la famille.");
    } finally {
      setEnCoursFamille(false);
    }
  }

  async function basculerActifFormule(formule: Formule) {
    try {
      await modifierFormuleRequete(token, formule.idFormule, { actif: formule.actif !== 1 });
      rechargerFamilles();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la mise à jour de la formule.");
    }
  }

  // grille de prix décodeur par formule — déjà calculée côté vente
  // (construireKitCalcul), réutilisée ici plutôt que de dupliquer la logique
  function grillePrixDecodeur(idFamille: number, idKit: number): Record<number, number> {
    const kitVente = catalogueVente.find((f) => f.idFamille === idFamille)?.kits.find((k) => k.idKit === idKit);
    if (kitVente?.reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE") return kitVente.prixDecodeurParFormule;
    return {};
  }

  async function definirPrixDecodeur(idKit: number) {
    const idFormule = grilleFormuleId[idKit];
    const prix = grillePrix[idKit];
    if (!idFormule || prix === undefined || prix === "") return;
    try {
      await definirPrixDecodeurKitRequete(token, { idKit, idFormule: Number(idFormule), prixDecodeur: Number(prix) });
      setGrilleFormuleId((v) => ({ ...v, [idKit]: "" }));
      setGrillePrix((v) => ({ ...v, [idKit]: "" }));
      rechargerCatalogueVente();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'enregistrement du prix décodeur.");
    }
  }

  async function supprimerPrixDecodeur(idKit: number, idFormule: number) {
    try {
      await supprimerPrixDecodeurKitRequete(token, idKit, idFormule);
      rechargerCatalogueVente();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la suppression du prix décodeur.");
    }
  }

  const toutesLesFormules = familles.flatMap((f) => (formulesParFamille[f.idFamille] ?? []).map((fo) => ({ ...fo, familleLibelle: f.libelle })));

  async function lierOption(idOption: number) {
    const idFormule = liaisonFormuleId[idOption];
    if (!idFormule) return;
    const prixSurcharge = liaisonPrixSurcharge[idOption];
    try {
      await lierOptionFormuleRequete(token, { idFormule: Number(idFormule), idOption, prixSurcharge: prixSurcharge ? Number(prixSurcharge) : undefined });
      setLiaisonFormuleId((v) => ({ ...v, [idOption]: "" }));
      setLiaisonPrixSurcharge((v) => ({ ...v, [idOption]: "" }));
      rechargerOptions();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la liaison.");
    }
  }

  async function delierOption(idOption: number, idFormule: number) {
    try {
      await delierOptionFormuleRequete(token, idOption, idFormule);
      rechargerOptions();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la suppression de la liaison.");
    }
  }

  function libelleFormule(idFormule: number) {
    const f = toutesLesFormules.find((fo) => fo.idFormule === idFormule);
    return f ? `${f.familleLibelle} — ${f.libelle}` : `Formule n° ${idFormule}`;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Familles et formules</p>
          <div className="flex items-center gap-2">
            <Input
              value={nouvelleFamille}
              onChange={(e) => setNouvelleFamille(e.target.value)}
              placeholder="Nouvelle famille (ex. MOREPLEX)…"
              className="h-9 w-56"
            />
            <Button size="sm" className="cursor-pointer gap-1" disabled={!nouvelleFamille.trim() || enCoursFamille} onClick={creerFamille}>
              <Plus className="size-4" />
              Ajouter
            </Button>
          </div>
        </div>

        <ul className="space-y-3">
          {familles.map((famille) => (
            <li key={famille.idFamille}>
              <Card className="gap-2 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-card-foreground">{famille.libelle}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer gap-1"
                    onClick={() => {
                      setFormuleEnEdition(null);
                      setFormuleDialogFamilleId(famille.idFamille);
                    }}
                  >
                    <Plus className="size-3.5" />
                    Formule
                  </Button>
                </div>
                <ul className="space-y-1.5">
                  {(formulesParFamille[famille.idFamille] ?? []).length === 0 && (
                    <li className="text-sm text-muted-foreground">Aucune formule.</li>
                  )}
                  {(formulesParFamille[famille.idFamille] ?? []).map((f) => (
                    <li key={f.idFormule} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                      <div className="text-sm">
                        <span className="font-medium text-card-foreground">{f.libelle}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {formateurFcfa.format(f.prix)} FCFA · rang {f.rang} · {LIBELLES_MODE_DUREE[f.modeDuree]} × {f.dureeCycles}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={f.actif === 1 ? "default" : "outline"}>{f.actif === 1 ? "Active" : "Inactive"}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                          onClick={() => {
                            setFormuleEnEdition(f);
                            setFormuleDialogFamilleId(famille.idFamille);
                          }}
                        >
                          Modifier
                        </Button>
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => basculerActifFormule(f)}>
                          {f.actif === 1 ? "Désactiver" : "Réactiver"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between border-t border-border pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kits</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer gap-1"
                    onClick={() => {
                      setKitEnEdition(null);
                      setKitDialogFamilleId(famille.idFamille);
                    }}
                  >
                    <Plus className="size-3.5" />
                    Kit
                  </Button>
                </div>
                <ul className="space-y-1.5">
                  {(kitsParFamille[famille.idFamille] ?? []).length === 0 && <li className="text-sm text-muted-foreground">Aucun kit.</li>}
                  {(kitsParFamille[famille.idFamille] ?? []).map((k) => {
                    const grille = grillePrixDecodeur(famille.idFamille, k.idKit);
                    return (
                      <li key={k.idKit} className="space-y-2 rounded-md border border-border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm">
                            <span className="font-medium text-card-foreground">{k.libelle}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              — {LIBELLES_REGLE_PRIX[k.reglePrix]}
                              {k.reglePrix === "PRIX_FIXE" && k.prixFixe !== null && ` · ${formateurFcfa.format(k.prixFixe)} FCFA`}
                              {k.reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL" &&
                                k.prixKitReference !== null &&
                                ` · ${formateurFcfa.format(k.prixKitReference)} FCFA à ${libelleFormule(k.idFormuleReference!)}`}
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="cursor-pointer"
                            onClick={() => {
                              setKitEnEdition(k);
                              setKitDialogFamilleId(famille.idFamille);
                            }}
                          >
                            Modifier
                          </Button>
                        </div>

                        {k.reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" && (
                          <div className="space-y-1.5 border-t border-border pt-2">
                            {Object.entries(grille).map(([idFormuleStr, prix]) => (
                              <div key={idFormuleStr} className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>
                                  {libelleFormule(Number(idFormuleStr))} — {formateurFcfa.format(prix)} FCFA
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 cursor-pointer px-2"
                                  onClick={() => supprimerPrixDecodeur(k.idKit, Number(idFormuleStr))}
                                >
                                  Retirer
                                </Button>
                              </div>
                            ))}
                            <div className="flex items-center gap-2">
                              <Select value={grilleFormuleId[k.idKit] ?? ""} onValueChange={(v) => setGrilleFormuleId((s) => ({ ...s, [k.idKit]: v }))}>
                                <SelectTrigger className="h-8 flex-1 text-xs" aria-label={`Formule pour ${k.libelle}`}>
                                  <SelectValue placeholder="Formule…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(formulesParFamille[famille.idFamille] ?? []).map((f) => (
                                    <SelectItem key={f.idFormule} value={String(f.idFormule)}>
                                      {f.libelle}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                min={0}
                                value={grillePrix[k.idKit] ?? ""}
                                onChange={(e) => setGrillePrix((s) => ({ ...s, [k.idKit]: e.target.value }))}
                                placeholder="Prix décodeur"
                                className="h-8 w-32 text-xs"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 cursor-pointer px-2 text-xs"
                                disabled={!grilleFormuleId[k.idKit] || !grillePrix[k.idKit]}
                                onClick={() => definirPrixDecodeur(k.idKit)}
                              >
                                Enregistrer
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Options / compléments ({options.length})</p>
          <Button
            size="sm"
            className="cursor-pointer gap-1"
            onClick={() => {
              setOptionEnEdition(null);
              setOptionDialogOuvert(true);
            }}
          >
            <Plus className="size-4" />
            Nouvelle option
          </Button>
        </div>
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.idOption}>
              <Card className="gap-2 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-card-foreground">
                    {o.libelle} <span className="font-normal text-muted-foreground">— {formateurFcfa.format(o.prix)} FCFA par défaut</span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => {
                      setOptionEnEdition(o);
                      setOptionDialogOuvert(true);
                    }}
                  >
                    Modifier
                  </Button>
                </div>

                {o.formulesCompatibles.length > 0 && (
                  <ul className="space-y-1">
                    {o.formulesCompatibles.map((c) => (
                      <li key={c.idFormule} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                        <span>
                          {libelleFormule(c.idFormule)}
                          {c.prixSurcharge !== null ? ` — ${formateurFcfa.format(c.prixSurcharge)} FCFA` : ""}
                        </span>
                        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => delierOption(o.idOption, c.idFormule)}>
                          Délier
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-2 border-t border-border pt-2">
                  <Select value={liaisonFormuleId[o.idOption] ?? ""} onValueChange={(v) => setLiaisonFormuleId((s) => ({ ...s, [o.idOption]: v }))}>
                    <SelectTrigger className="h-9 flex-1" aria-label={`Lier ${o.libelle} à une formule`}>
                      <SelectValue placeholder="Lier à une formule…" />
                    </SelectTrigger>
                    <SelectContent>
                      {toutesLesFormules.map((f) => (
                        <SelectItem key={f.idFormule} value={String(f.idFormule)}>
                          {f.familleLibelle} — {f.libelle}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    value={liaisonPrixSurcharge[o.idOption] ?? ""}
                    onChange={(e) => setLiaisonPrixSurcharge((s) => ({ ...s, [o.idOption]: e.target.value }))}
                    placeholder="Prix surchargé (optionnel)"
                    className="h-9 w-48"
                  />
                  <Button variant="outline" size="sm" className="cursor-pointer" disabled={!liaisonFormuleId[o.idOption]} onClick={() => lierOption(o.idOption)}>
                    Lier
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      <NouvelleFormuleDialog
        ouvert={formuleDialogFamilleId !== null}
        familles={familles}
        formule={formuleEnEdition}
        idFamilleInitiale={formuleDialogFamilleId}
        onFerme={() => setFormuleDialogFamilleId(null)}
        onSucces={() => {
          setFormuleDialogFamilleId(null);
          rechargerFamilles();
        }}
      />

      <NouvelleOptionDialog
        ouvert={optionDialogOuvert}
        option={optionEnEdition}
        onFerme={() => setOptionDialogOuvert(false)}
        onSucces={() => {
          setOptionDialogOuvert(false);
          rechargerOptions();
        }}
      />

      <NouveauKitDialog
        ouvert={kitDialogFamilleId !== null}
        idFamille={kitDialogFamilleId}
        formulesFamille={kitDialogFamilleId ? (formulesParFamille[kitDialogFamilleId] ?? []) : []}
        kit={kitEnEdition}
        onFerme={() => setKitDialogFamilleId(null)}
        onSucces={() => {
          setKitDialogFamilleId(null);
          rechargerFamilles();
          rechargerCatalogueVente();
        }}
      />
    </div>
  );
}
