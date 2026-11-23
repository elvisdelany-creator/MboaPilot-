import { and, eq } from "drizzle-orm";
import { calculerCoutMoyenPondere, normaliserLibelle } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "./stock.repository.js";
import { exigerCorpsObjet, verifierEntier } from "../../lib/validation.js";
import { texteFacultatif } from "../../lib/champs-texte.js";
import { normaliserCodeBarres, trouverProduitParCodeBarres } from "../produits/produit.repository.js";

export interface TransfererStockParams {
  idProduitSource: number;
  siteDestinationId: number;
  quantite: number;
  motif?: string;
  userId: number;
}

export interface TransfertResultat {
  produitSource: typeof schema.produit.$inferSelect;
  produitDestination: typeof schema.produit.$inferSelect;
}

// 5.2, 8.2 : transfert inter-site — mouvement double (− au site source, + au
// site destination), tracé comme les autres mouvements de stock. Le modèle
// de données rattache chaque article à un site (2.5.2, mode centralisé) : un
// transfert associe l'article du site destination portant le même libellé
// (insensible à la casse/espaces) et le crée en le reprenant de la fiche
// source s'il n'existe pas encore là-bas — un gérant qui déplace un article
// vers une autre boutique ne doit pas d'abord aller le créer manuellement là-bas.
export function transfererStock(db: Db, params: TransfererStockParams): TransfertResultat {
  verifierParamsTransfert(params);
  // atomique : le produit de destination était créé avant les mouvements — un échec laissait un article orphelin
  return db.transaction(() => transfererStockSansTransaction(db, params));
}

// Un champ absent ou mal typé (tableau, texte à la place d'un nombre) n'était arrêté que par la base, avec un message générique qui ne dit pas
// lequel corriger. La route appelle aussi ce contrôle, avant de chercher le produit.
export function verifierParamsTransfert(params: unknown): void {
  exigerCorpsObjet(params);
  const champs = params as Record<string, unknown>;
  verifierEntier(champs.idProduitSource, "Le produit à transférer", { min: 1, requis: true, nullable: false });
  verifierEntier(champs.siteDestinationId, "La boutique de destination", { min: 1, requis: true, nullable: false });
  verifierEntier(champs.quantite, "La quantité à transférer", { min: 1, requis: true, nullable: false, message: "La quantité transférée doit être positive" });
  texteFacultatif(champs.motif, "Le motif du transfert", 200);
}

function transfererStockSansTransaction(db: Db, params: TransfererStockParams): TransfertResultat {
  if (params.quantite <= 0) throw new Error("La quantité transférée doit être positive");

  const source = db.select().from(schema.produit).where(eq(schema.produit.idProduit, params.idProduitSource)).get();
  if (!source) throw new Error(`Produit ${params.idProduitSource} introuvable`);

  const siteDestination = db.select().from(schema.site).where(eq(schema.site.idSite, params.siteDestinationId)).get();
  if (!siteDestination) throw new Error(`Site ${params.siteDestinationId} introuvable`);

  if (source.siteId === params.siteDestinationId) throw new Error("Le site de destination doit être différent du site source");
  // l'écran ne propose que les sites actifs : le serveur l'impose aussi (un article ne se crée pas dans une boutique fermée)
  if (siteDestination.actif !== 1) throw new Error(`Le site « ${siteDestination.nom} » est désactivé : il ne peut pas recevoir de stock`);

  // 8.2 : même repère qu'à l'import CSV — un article retapé sans accent au
  // site destination ne doit pas créer un doublon (comparaison en JS, la
  // normalisation NFD n'a pas d'équivalent SQLite natif fiable)
  const candidatsDestination = db
    .select()
    .from(schema.produit)
    .where(and(eq(schema.produit.siteId, params.siteDestinationId), eq(schema.produit.type, source.type)))
    .all();
  let destination = candidatsDestination.find((p) => normaliserLibelle(p.libelle) === normaliserLibelle(source.libelle));

  if (!destination) {
    // un code-barres n'appartient qu'à un article par site : l'article créé ici ne reprend pas un code déjà porté par un autre
    const codeSource = normaliserCodeBarres(source.codeBarres) ?? null;
    const codeReprenable = codeSource && !trouverProduitParCodeBarres(db, params.siteDestinationId, codeSource) ? codeSource : null;
    destination = db
      .insert(schema.produit)
      .values({
        siteId: params.siteDestinationId,
        type: source.type,
        libelle: source.libelle,
        categorie: source.categorie,
        codeBarres: codeReprenable,
        prixVente: source.prixVente,
        coutRevient: source.coutRevient,
        margeType: source.margeType,
        margeValeur: source.margeValeur,
        margePourcentage: source.margePourcentage,
        suiviStock: source.suiviStock,
        seuilAlerte: source.seuilAlerte,
      })
      .returning()
      .get();
  }

  const produitSource = enregistrerMouvement(db, {
    idProduit: source.idProduit,
    siteId: source.siteId,
    typeMouvement: "TRANSFERT_SORTIE",
    quantite: params.quantite,
    motif: params.motif,
    utilisateurId: params.userId,
  });

  // 5.2 : une entrée de stock recalcule le coût de revient en coût moyen pondéré — les unités transférées arrivent au coût du site
  // source, pondéré avec le stock que le site destination détient déjà (calculé avant que le mouvement n'en change la quantité)
  const coutMoyenDestination = calculerCoutMoyenPondere(destination.quantiteStock, destination.coutRevient, params.quantite, source.coutRevient);

  enregistrerMouvement(db, {
    idProduit: destination.idProduit,
    siteId: params.siteDestinationId,
    typeMouvement: "TRANSFERT_ENTREE",
    quantite: params.quantite,
    motif: params.motif,
    utilisateurId: params.userId,
  });

  const produitDestination = db
    .update(schema.produit)
    .set({ coutRevient: coutMoyenDestination })
    .where(eq(schema.produit.idProduit, destination.idProduit))
    .returning()
    .get();

  return { produitSource, produitDestination };
}
