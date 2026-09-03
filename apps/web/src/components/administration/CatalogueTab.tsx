import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  chargerFamilles,
  chargerFormulesFamille,
  chargerOptions,
  creerFamilleRequete,
  delierOptionFormuleRequete,
  ErreurAuthentification,
  lierOptionFormuleRequete,
  modifierFormuleRequete,
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
import type { Famille, Formule, OptionCatalogue } from "@/lib/types";

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const LIBELLES_MODE_DUREE: Record<"STRICT_30J" | "MOIS_CIVIL", string> = { STRICT_30J: "30 jours stricts", MOIS_CIVIL: "Mois civil" };

// 8.8 : back-office catalogue — familles, formules (prix, rang, mode de
// calcul de validité 4.1) et options/compléments, sans intervention
// développeur. L'édition des règles de prix dynamique des kits (5.1.1)
// reste hors périmètre de cette itération.
export function CatalogueTab() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [familles, setFamilles] = useState<Famille[]>([]);
  const [formulesParFamille, setFormulesParFamille] = useState<Record<number, Formule[]>>({});
  const [options, setOptions] = useState<OptionCatalogue[]>([]);
  const [nouvelleFamille, setNouvelleFamille] = useState("");
  const [enCoursFamille, setEnCoursFamille] = useState(false);
  const [formuleDialogFamilleId, setFormuleDialogFamilleId] = useState<number | null>(null);
  const [formuleEnEdition, setFormuleEnEdition] = useState<Formule | null>(null);
  const [optionDialogOuvert, setOptionDialogOuvert] = useState(false);
  const [optionEnEdition, setOptionEnEdition] = useState<OptionCatalogue | null>(null);
  const [liaisonFormuleId, setLiaisonFormuleId] = useState<Record<number, string>>({});
  const [liaisonPrixSurcharge, setLiaisonPrixSurcharge] = useState<Record<number, string>>({});

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
      })
      .catch((e) => gererErreur(e, "Impossible de charger les familles."));
  }

  function rechargerOptions() {
    chargerOptions(token)
      .then(setOptions)
      .catch((e) => gererErreur(e, "Impossible de charger les options."));
  }

  useEffect(rechargerFamilles, [token]);
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
    </div>
  );
}
