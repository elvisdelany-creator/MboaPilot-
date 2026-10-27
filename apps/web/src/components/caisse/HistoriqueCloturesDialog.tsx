import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { lireDateServeur } from "@mboapilot/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  chargerClotures,
  chargerComptagesCloture,
  ErreurAuthentification,
  type ClotureCaisse,
  type ComptageCloture,
  type ModePaiementCloture,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  open: boolean;
  onFerme: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const LIBELLE_MODE: Record<ModePaiementCloture, string> = { CASH: "Comptant", CHEQUE: "Chèque", VIREMENT: "Virement", MOBILE_MONEY: "Mobile Money" };

// l'écart se lit sans la couleur : un mot et une icône disent s'il manque de l'argent ou s'il y en a trop
function etatEcart(ecart: number): { libelle: string; manque: boolean; juste: boolean } {
  if (ecart === 0) return { libelle: "Caisse juste", manque: false, juste: true };
  return ecart < 0
    ? { libelle: `Manque ${formateurFcfa.format(-ecart)} FCFA`, manque: true, juste: false }
    : { libelle: `Excédent ${formateurFcfa.format(ecart)} FCFA`, manque: false, juste: false };
}

function BadgeEcart({ ecart }: { ecart: number }) {
  const etat = etatEcart(ecart);
  const Icone = etat.juste ? CheckCircle2 : TriangleAlert;
  return (
    <Badge variant={etat.juste ? "outline" : "secondary"} className="gap-1 tabular-nums">
      <Icone className="size-3.5" aria-hidden="true" />
      {etat.libelle}
    </Badge>
  );
}

// 13.1 : « c'est l'un des premiers contrôles qu'un gérant réclamera à l'usage » — l'historique des sessions de caisse, avec l'écart
// de chacune et, au dépliage, le comptage par mode de paiement. Réservé à l'encadrement qui valide les clôtures.
export function HistoriqueCloturesDialog({ open, onFerme }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const siteId = session!.utilisateur.siteId;

  const [clotures, setClotures] = useState<ClotureCaisse[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [deplie, setDeplie] = useState<number | null>(null);
  const [comptages, setComptages] = useState<Record<number, ComptageCloture[]>>({});

  function gererErreur(e: unknown, message: string) {
    if (e instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(e instanceof Error ? e.message : message);
  }

  function charger() {
    setClotures(null);
    setErreur(false);
    chargerClotures(token, siteId)
      .then(setClotures)
      .catch((e) => {
        setErreur(true);
        gererErreur(e, "Impossible de charger l'historique des clôtures.");
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setDeplie(null);
    charger();
  }, [open]);

  function basculer(idCloture: number) {
    if (deplie === idCloture) {
      setDeplie(null);
      return;
    }
    setDeplie(idCloture);
    if (comptages[idCloture]) return;
    chargerComptagesCloture(token, idCloture)
      .then((liste) => setComptages((precedent) => ({ ...precedent, [idCloture]: liste })))
      .catch((e) => gererErreur(e, "Impossible de charger le comptage de cette session."));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent className="max-h-[85vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historique des clôtures de caisse</DialogTitle>
          <DialogDescription>Les sessions de ce site, de la plus récente à la plus ancienne, avec l'écart entre le théorique et le compté.</DialogDescription>
        </DialogHeader>

        {clotures === null && !erreur && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {erreur && (
          <div className="space-y-2">
            <p className="text-sm text-card-foreground">L'historique n'a pas pu être chargé.</p>
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={charger}>
              Réessayer
            </Button>
          </div>
        )}
        {clotures !== null && clotures.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune session de caisse pour l'instant : l'historique apparaîtra dès la première ouverture.</p>
        )}

        {clotures !== null && clotures.length > 0 && (
          <ul className="space-y-2">
            {clotures.map((c) => {
              const ouvert = deplie === c.idCloture;
              return (
                <li key={c.idCloture} className="rounded-lg border border-border">
                  <button
                    type="button"
                    className="flex min-h-12 w-full cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-left"
                    aria-expanded={ouvert}
                    aria-controls={`cloture-${c.idCloture}`}
                    onClick={() => basculer(c.idCloture)}
                  >
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="block font-medium text-card-foreground">
                        Session n° {c.idCloture} — {formateurDateHeure.format(lireDateServeur(c.dateOuverture))}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        Ouverte par {c.ouvertParNom ?? "—"} · fond {formateurFcfa.format(c.fondOuverture)} FCFA
                        {c.statut === "FERMEE" && c.dateFermeture
                          ? ` · fermée le ${formateurDateHeure.format(lireDateServeur(c.dateFermeture))} par ${c.fermeParNom ?? "—"}`
                          : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {c.statut === "FERMEE" ? <BadgeEcart ecart={c.ecartTotal ?? 0} /> : <Badge variant="default">En cours</Badge>}
                      {ouvert ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                    </span>
                  </button>

                  {ouvert && (
                    <div id={`cloture-${c.idCloture}`} className="border-t border-border p-3">
                      {c.statut === "OUVERTE" ? (
                        <p className="text-sm text-muted-foreground">Cette session est encore ouverte : le comptage se fait à la fermeture.</p>
                      ) : !comptages[c.idCloture] ? (
                        <p className="text-sm text-muted-foreground">Chargement du comptage…</p>
                      ) : (
                        <table className="w-full text-sm">
                          <caption className="sr-only">Comptage par mode de paiement de la session n° {c.idCloture}</caption>
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th scope="col" className="pb-1 font-semibold">Mode</th>
                              <th scope="col" className="pb-1 text-right font-semibold">Théorique</th>
                              <th scope="col" className="pb-1 text-right font-semibold">Compté</th>
                              <th scope="col" className="pb-1 text-right font-semibold">Écart</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comptages[c.idCloture].map((l) => (
                              <tr key={l.idComptage} className="border-t border-border/60">
                                <th scope="row" className="py-1.5 text-left font-normal text-card-foreground">{LIBELLE_MODE[l.mode]}</th>
                                <td className="py-1.5 text-right tabular-nums">{formateurFcfa.format(l.montantTheorique)}</td>
                                <td className="py-1.5 text-right tabular-nums">{formateurFcfa.format(l.montantCompte)}</td>
                                <td className="py-1.5 text-right tabular-nums">
                                  <span className={l.ecart === 0 ? "" : "font-medium text-alert-j3-fg"}>
                                    {l.ecart > 0 ? "+" : ""}
                                    {formateurFcfa.format(l.ecart)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
