import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Plus, Wrench } from "lucide-react";
import { peutTransitionnerSav, type StatutSav } from "@mboapilot/shared";
import { chargerDossierSav, chargerDossiersSav, chargerUrlPhotoSav, televerserPhotoSav, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { NouveauDossierDialog } from "./NouveauDossierDialog";
import { ChangerStatutDialog } from "./ChangerStatutDialog";
import { AjouterPieceDialog } from "./AjouterPieceDialog";
import type { DossierSav, DossierSavDetaille } from "@/lib/types";

interface Props {
  onNaviguer: (vue: Vue) => void;
}

const LIBELLES_STATUT: Record<StatutSav, string> = {
  RECU: "Reçu",
  DIAGNOSTIC: "En diagnostic",
  DEVIS_ATTENTE: "Devis en attente",
  REPARATION: "En réparation",
  PRET: "Prêt",
  LIVRE: "Livré",
  IRREPARABLE: "Irréparable",
  ABANDONNE: "Abandonné",
};

const VARIANTE_STATUT: Record<StatutSav, "secondary" | "default" | "outline" | "destructive"> = {
  RECU: "secondary",
  DIAGNOSTIC: "secondary",
  DEVIS_ATTENTE: "secondary",
  REPARATION: "default",
  PRET: "default",
  LIVRE: "outline",
  IRREPARABLE: "destructive",
  ABANDONNE: "destructive",
};

const TOUS_LES_STATUTS: StatutSav[] = [
  "RECU",
  "DIAGNOSTIC",
  "DEVIS_ATTENTE",
  "REPARATION",
  "PRET",
  "LIVRE",
  "IRREPARABLE",
  "ABANDONNE",
];

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

// 5.10, 8.4 : module SAV — liste des dossiers + détail et actions de cycle de vie
export function SavPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const siteId = session!.utilisateur.siteId;

  const [dossiers, setDossiers] = useState<DossierSav[] | null>(null);
  const [idSelectionne, setIdSelectionne] = useState<number | null>(null);
  const [detail, setDetail] = useState<DossierSavDetaille | null>(null);
  const [nouveauOuvert, setNouveauOuvert] = useState(false);
  const [pieceOuvert, setPieceOuvert] = useState(false);
  const [statutCible, setStatutCible] = useState<StatutSav | null>(null);
  // 5.10 : "photos optionnelles" du dossier SAV
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [televersementEnCours, setTeleversementEnCours] = useState(false);
  const fichierPhotoRef = useRef<HTMLInputElement>(null);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerListe() {
    chargerDossiersSav(token, siteId)
      .then(setDossiers)
      .catch((e) => gererErreur(e, "Impossible de charger les dossiers SAV."));
  }

  function rechargerDetail(id: number) {
    chargerDossierSav(token, id)
      .then(setDetail)
      .catch((e) => gererErreur(e, "Impossible de charger le dossier."));
  }

  useEffect(rechargerListe, [token, siteId]);

  useEffect(() => {
    if (idSelectionne !== null) rechargerDetail(idSelectionne);
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSelectionne]);

  // 5.10 : charge chaque photo en blob (l'endpoint exige une authentification
  // Bearer, incompatible avec une balise <img src> classique)
  useEffect(() => {
    if (!detail) return;
    detail.photos.forEach((p) => {
      setPhotoUrls((prev) => {
        if (prev[p.idPhoto]) return prev;
        chargerUrlPhotoSav(token, p.idPhoto)
          .then((url) => setPhotoUrls((courant) => ({ ...courant, [p.idPhoto]: url })))
          .catch(() => {});
        return prev;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.idDossierSav, detail?.photos.length]);

  async function gererFichierPhotoChoisi(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier || !detail) return;
    setTeleversementEnCours(true);
    try {
      await televerserPhotoSav(token, detail.idDossierSav, fichier);
      toast.success("Photo ajoutée.");
      rechargerDetail(detail.idDossierSav);
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'envoi de la photo.");
    } finally {
      setTeleversementEnCours(false);
    }
  }

  const prochainesTransitions =
    detail !== null ? TOUS_LES_STATUTS.filter((s) => peutTransitionnerSav(detail.statut, s)) : [];
  const estTerminal = detail !== null && prochainesTransitions.length === 0;
  const peutAjouterPiece = detail !== null && !estTerminal && detail.statut !== "PRET" && detail.statut !== "LIVRE";

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="sav" onNaviguer={onNaviguer} />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h1 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dossiers SAV</h1>
            <Button size="sm" className="cursor-pointer gap-1" onClick={() => setNouveauOuvert(true)}>
              <Plus className="size-4" />
              Nouveau
            </Button>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {dossiers?.length === 0 && <li className="p-4 text-sm text-muted-foreground">Aucun dossier.</li>}
            {dossiers?.map((d) => (
              <li key={d.idDossierSav}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer flex-col items-start gap-1 border-b border-border px-4 py-3 text-left hover:bg-muted ${idSelectionne === d.idDossierSav ? "bg-muted" : ""}`}
                  onClick={() => setIdSelectionne(d.idDossierSav)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-medium text-foreground">Dossier n° {d.idDossierSav}</span>
                    <Badge variant={VARIANTE_STATUT[d.statut]}>{LIBELLES_STATUT[d.statut]}</Badge>
                  </div>
                  <span className="line-clamp-1 text-sm text-muted-foreground">{d.descriptionPanne}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!detail && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Wrench className="mx-auto mb-2 size-8" />
                Sélectionnez un dossier pour voir le détail.
              </div>
            </div>
          )}

          {detail && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">Dossier n° {detail.idDossierSav}</h2>
                  <p className="text-sm text-muted-foreground">Reçu le {formateurDate.format(new Date(detail.dateReception))}</p>
                </div>
                <Badge variant={VARIANTE_STATUT[detail.statut]}>{LIBELLES_STATUT[detail.statut]}</Badge>
              </div>

              <Card className="gap-3 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Panne annoncée</p>
                  <p className="text-sm text-card-foreground">{detail.descriptionPanne}</p>
                </div>
                {detail.etatReception && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">État à la réception</p>
                    <p className="text-sm text-card-foreground">{detail.etatReception}</p>
                  </div>
                )}
                {detail.diagnostic && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diagnostic</p>
                    <p className="text-sm text-card-foreground">{detail.diagnostic}</p>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Garantie</span>
                  <span className="text-card-foreground">{detail.sousGarantie === 1 ? "Sous garantie" : "Hors garantie"}</span>
                </div>
                {detail.facture && (
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>Facture</span>
                    <span className="tabular-nums text-primary">
                      {formateurFcfa.format(detail.facture.montantTotal)} FCFA — {detail.facture.statut === "VALIDEE" ? "encaissée" : "en attente"}
                    </span>
                  </div>
                )}
              </Card>

              {detail.pieces.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pièces affectées</p>
                  <ul className="space-y-1 text-sm text-card-foreground">
                    {detail.pieces.map((p) => (
                      <li key={p.idPieceUtilisee}>Produit n° {p.idProduit} × {p.quantite}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer gap-1"
                    disabled={televersementEnCours}
                    onClick={() => fichierPhotoRef.current?.click()}
                  >
                    <ImagePlus className="size-4" />
                    {televersementEnCours ? "Envoi…" : "Ajouter une photo"}
                  </Button>
                  <input ref={fichierPhotoRef} type="file" accept="image/*" hidden onChange={gererFichierPhotoChoisi} />
                </div>
                {detail.photos.length === 0 && <p className="text-sm text-muted-foreground">Aucune photo.</p>}
                {detail.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {detail.photos.map((p) => (
                      <a key={p.idPhoto} href={photoUrls[p.idPhoto]} target="_blank" rel="noreferrer" title={p.nomFichierOriginal}>
                        {photoUrls[p.idPhoto] ? (
                          <img src={photoUrls[p.idPhoto]} alt={p.nomFichierOriginal} className="size-20 rounded-md border border-border object-cover" />
                        ) : (
                          <div className="size-20 animate-pulse rounded-md border border-border bg-muted" />
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historique</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {detail.historique.map((h) => (
                    <li key={h.idHistoSav}>
                      {formateurDate.format(new Date(h.dateChangement))} — {h.statutAvant ? `${LIBELLES_STATUT[h.statutAvant]} → ` : ""}
                      {LIBELLES_STATUT[h.statutApres]}
                      {h.motif ? ` (${h.motif})` : ""}
                    </li>
                  ))}
                </ul>
              </div>

              <Separator />

              <div className="flex flex-wrap gap-2">
                {peutAjouterPiece && (
                  <Button variant="outline" className="cursor-pointer" onClick={() => setPieceOuvert(true)}>
                    Ajouter une pièce
                  </Button>
                )}
                {prochainesTransitions.map((s) => (
                  <Button
                    key={s}
                    variant={s === "IRREPARABLE" || s === "ABANDONNE" ? "outline" : "default"}
                    className="cursor-pointer"
                    onClick={() => setStatutCible(s)}
                  >
                    {LIBELLES_STATUT[s]}
                  </Button>
                ))}
                {estTerminal && <p className="text-sm text-muted-foreground">Dossier clôturé — aucune action possible.</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <NouveauDossierDialog ouvert={nouveauOuvert} onFerme={() => setNouveauOuvert(false)} onSucces={() => { setNouveauOuvert(false); rechargerListe(); }} />

      {detail && (
        <>
          <AjouterPieceDialog
            ouvert={pieceOuvert}
            idDossierSav={detail.idDossierSav}
            onFerme={() => setPieceOuvert(false)}
            onSucces={() => { setPieceOuvert(false); rechargerDetail(detail.idDossierSav); }}
          />
          <ChangerStatutDialog
            dossier={detail}
            statutCible={statutCible}
            onFerme={() => setStatutCible(null)}
            onSucces={() => { setStatutCible(null); rechargerDetail(detail.idDossierSav); rechargerListe(); }}
          />
        </>
      )}
    </div>
  );
}
