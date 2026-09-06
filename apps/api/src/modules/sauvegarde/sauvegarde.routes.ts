import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { creerSauvegarde, listerSauvegardes } from "./sauvegarde.service.js";

// 2.6 : sauvegardes — accès réservé à l'Administrateur (export complet des
// données de l'entreprise, y compris les identifiants de comptes streaming
// partagés et les mots de passe hachés).
export function registerSauvegardeRoutes(app: FastifyInstance, db: Db, dossierSauvegardes: string, guards: { authRequis: Guard; admin: Guard }) {
  app.get("/api/v1/sauvegarde", { preHandler: [guards.authRequis, guards.admin] }, async (_request, reply) => {
    reply.code(200).send(listerSauvegardes(dossierSauvegardes));
  });

  // « Exporter mes données » (2.6) : sauvegarde à la demande, puis
  // téléchargement immédiat du fichier produit.
  app.post("/api/v1/sauvegarde/export", { preHandler: [guards.authRequis, guards.admin] }, async (_request, reply) => {
    const sauvegarde = creerSauvegarde(db, dossierSauvegardes);
    reply
      .code(200)
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename=${sauvegarde.nomFichier}`)
      .send(readFileSync(join(dossierSauvegardes, sauvegarde.nomFichier)));
  });
}
