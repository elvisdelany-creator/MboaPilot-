# Démo publique de MboaPilot (voir docs/demo-publique.md). Image unique : compile l'interface puis lance `npm run start:demo`.
# Les outils de compilation servent au module natif SQLite (better-sqlite3) si aucun binaire précompilé n'existe pour la plateforme.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# d'abord les manifestes seuls : la couche des dépendances est réutilisée tant qu'ils ne changent pas
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build

# derrière les proxys de l'hébergeur ; données jetables dans /tmp ; remise à zéro forcée après 24 h de fonctionnement continu.
# MBOAPILOT_PROXY=3 : sur Render, X-Forwarded-For arrive sous la forme « visiteur, Cloudflare, serveur interne » (mesuré en novembre 2026) :
# le visiteur est la 3e adresse depuis la droite. Trop bas, on compterait l'adresse interne, qui change à chaque requête (plafond de débit
# inopérant) ; trop haut, une adresse inventée par le visiteur serait retenue. Autre hébergeur : à remesurer (docs/demo-publique.md).
ENV MBOAPILOT_PROXY=3 \
    MBOAPILOT_DEMO_DIR=/tmp/mboapilot-demo \
    MBOAPILOT_DEMO_REDEMARRAGE_HEURES=24

# l'hébergeur impose le port par la variable PORT (10000 par défaut chez Render)
EXPOSE 10000
RUN chown -R node:node /app
USER node
CMD ["npm", "run", "start:demo"]
