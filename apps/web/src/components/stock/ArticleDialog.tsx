import { useEffect, useState } from "react";
import { toast } from "sonner";
import { calculerMarge } from "@mboapilot/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { creerProduitRequete, modifierProduitRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { MargeType, Produit, TypeProduit } from "@/lib/types";

interface Props {
  ouvert: boolean;
  produit: Produit | null; // null = création d'un nouvel article, sinon édition
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

const LIBELLE_TYPE: Record<TypeProduit, string> = {
  BIEN: "Bien physique",
  SERVICE: "Service / prestation",
  SAV: "Article SAV",
  KIT: "Kit composé",
};

// 8.2, 6.1 : création/édition d'une fiche article, avec calculateur de marge
// valeur/pourcentage interchangeable (l'autre champ est recalculé en direct).
export function ArticleDialog({ ouvert, produit, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [type, setType] = useState<TypeProduit>("BIEN");
  const [libelle, setLibelle] = useState("");
  const [categorie, setCategorie] = useState("");
  const [codeBarres, setCodeBarres] = useState("");
  const [prixVente, setPrixVente] = useState("");
  const [coutRevient, setCoutRevient] = useState("");
  const [margeType, setMargeType] = useState<MargeType>("VALEUR");
  const [margeValeur, setMargeValeur] = useState("");
  const [margePourcentagePct, setMargePourcentagePct] = useState(""); // saisi en % lisible, ex. "15"
  const [suiviStock, setSuiviStock] = useState(false);
  const [seuilAlerte, setSeuilAlerte] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    if (produit) {
      setType(produit.type);
      setLibelle(produit.libelle);
      setCategorie(produit.categorie ?? "");
      setCodeBarres(produit.codeBarres ?? "");
      setPrixVente(String(produit.prixVente));
      setCoutRevient(String(produit.coutRevient));
      setMargeType(produit.margeType);
      setMargeValeur(produit.margeValeur !== null ? String(produit.margeValeur) : "");
      setMargePourcentagePct(produit.margePourcentage !== null ? String(produit.margePourcentage / 100) : "");
      setSuiviStock(produit.suiviStock === 1);
      setSeuilAlerte(produit.seuilAlerte !== null ? String(produit.seuilAlerte) : "");
    } else {
      setType("BIEN");
      setLibelle("");
      setCategorie("");
      setCodeBarres("");
      setPrixVente("");
      setCoutRevient("");
      setMargeType("VALEUR");
      setMargeValeur("");
      setMargePourcentagePct("");
      setSuiviStock(true);
      setSeuilAlerte("");
    }
  }, [ouvert, produit]);

  const coutRevientNum = Number(coutRevient) || 0;
  const margeCalculee = calculerMarge({
    margeType,
    coutRevient: coutRevientNum,
    margeValeur: margeType === "VALEUR" ? Number(margeValeur) || 0 : null,
    margePourcentage: margeType === "POURCENTAGE" ? Math.round((Number(margePourcentagePct) || 0) * 100) : null,
  });

  async function valider() {
    if (!libelle.trim() || !prixVente) return;
    setEnCours(true);
    try {
      const champsCommuns = {
        libelle: libelle.trim(),
        categorie: categorie.trim() || undefined,
        codeBarres: codeBarres.trim() || undefined,
        prixVente: Number(prixVente),
        coutRevient: coutRevientNum,
        margeType,
        margeValeur: margeType === "VALEUR" ? Number(margeValeur) || 0 : undefined,
        margePourcentage: margeType === "POURCENTAGE" ? Math.round((Number(margePourcentagePct) || 0) * 100) : undefined,
        seuilAlerte: seuilAlerte ? Number(seuilAlerte) : undefined,
      };

      if (produit) {
        await modifierProduitRequete(token, produit.idProduit, { ...champsCommuns, userId: utilisateur.idUser });
        toast.success(`Article « ${libelle.trim()} » mis à jour.`);
      } else {
        await creerProduitRequete(token, { ...champsCommuns, siteId: utilisateur.siteId, type, suiviStock });
        toast.success(`Article « ${libelle.trim()} » créé.`);
      }
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'enregistrement de l'article.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{produit ? "Modifier l'article" : "Nouvel article"}</DialogTitle>
          <DialogDescription>Catégorie ouverte, non limitative — libre à vous d'organiser votre catalogue.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="article-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TypeProduit)} disabled={produit !== null}>
                <SelectTrigger id="article-type" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LIBELLE_TYPE).map(([valeur, libelleType]) => (
                    <SelectItem key={valeur} value={valeur}>
                      {libelleType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="article-categorie">Catégorie</Label>
              <Input id="article-categorie" value={categorie} onChange={(e) => setCategorie(e.target.value)} placeholder="Ex. accessoires" className="mt-1" />
            </div>
          </div>

          <div>
            <Label htmlFor="article-libelle">Libellé</Label>
            <Input id="article-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label htmlFor="article-code-barres">Code interne / code-barres (optionnel)</Label>
            <Input id="article-code-barres" value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="article-cout">Coût de revient (FCFA)</Label>
              <Input id="article-cout" type="number" min={0} value={coutRevient} onChange={(e) => setCoutRevient(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="article-prix">Prix de vente (FCFA)</Label>
              <Input id="article-prix" type="number" min={0} value={prixVente} onChange={(e) => setPrixVente(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marge (6.1)</p>
            <Select value={margeType} onValueChange={(v) => setMargeType(v as MargeType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VALEUR">Gain en valeur (FCFA)</SelectItem>
                <SelectItem value="POURCENTAGE">Gain en pourcentage (%)</SelectItem>
              </SelectContent>
            </Select>

            <div className="mt-3 grid grid-cols-2 gap-3">
              {margeType === "VALEUR" ? (
                <div>
                  <Label htmlFor="article-marge-valeur">Marge (FCFA)</Label>
                  <Input id="article-marge-valeur" type="number" value={margeValeur} onChange={(e) => setMargeValeur(e.target.value)} className="mt-1" />
                </div>
              ) : (
                <div>
                  <Label htmlFor="article-marge-pct">Marge (%)</Label>
                  <Input id="article-marge-pct" type="number" step="0.01" value={margePourcentagePct} onChange={(e) => setMargePourcentagePct(e.target.value)} className="mt-1" />
                </div>
              )}
              <div className="flex flex-col justify-end text-sm text-muted-foreground">
                <span>
                  Soit {formateurFcfa.format(margeCalculee.margeValeur)} FCFA / {(margeCalculee.margePourcentage / 100).toFixed(2)} %
                </span>
              </div>
            </div>

            <p className="mt-2 text-sm font-medium text-card-foreground">
              Prix de vente suggéré : {formateurFcfa.format(margeCalculee.prixSuggere)} FCFA
              {Number(prixVente) > 0 && Number(prixVente) !== margeCalculee.prixSuggere && (
                <span className="ml-1 text-alert-j3-fg">(écart de {formateurFcfa.format(Number(prixVente) - margeCalculee.prixSuggere)} FCFA avec le prix saisi)</span>
              )}
            </p>
          </div>

          {produit === null && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={suiviStock} onCheckedChange={(v) => setSuiviStock(v === true)} />
              Suivi de stock pour cet article
            </label>
          )}

          {(suiviStock || produit?.suiviStock === 1) && (
            <div>
              <Label htmlFor="article-seuil">Seuil d'alerte de réapprovisionnement</Label>
              <Input id="article-seuil" type="number" min={0} value={seuilAlerte} onChange={(e) => setSeuilAlerte(e.target.value)} className="mt-1" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!libelle.trim() || !prixVente || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : produit ? "Enregistrer les modifications" : "Créer l'article"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
