# Migration de la base de données (Render → Neon/Supabase)

Objectif : déplacer les données vers un PostgreSQL gratuit **permanent** (Neon/Supabase, sans expiration) sans qu'aucun utilisateur ne perde sa liste.

## Pourquoi aucune liste n'est perdue

- Les listes sont copiées **avec le même `id` et le même `admin_token`** : les liens partagés (`#/s/srv:<id>`), les aperçus WhatsApp (`/index.html?list=<id>`) et les jetons des propriétaires (stockés dans leur navigateur) continuent de fonctionner tels quels.
- Les réservations sont copiées telles quelles : articles toujours « réservés », confidentialité préservée.
- Les listes en mode autonome (GitHub Pages / lien encodé) vivent dans le navigateur ou dans le lien : non concernées par la migration.

## Prérequis

- Un ordinateur avec Node ≥ 16 (`node --version`) et un accès réseau
- Le dépôt cloné localement :
  ```bash
  git clone https://github.com/emicruche/andconcept-list.git
  cd andconcept-list && npm install
  ```
- **Attention** : sur le tier gratuit, les services web Render n'ont **pas de shell**. Le script se lance donc depuis votre ordinateur, jamais depuis Render.

## Étape 1 — Créer la base cible sur Neon (gratuit, permanent)

1. neon.tech → Sign up → **Create project** → nom `andconcept-list`, région **Europe (Frankfurt)**
2. Dashboard du projet → **Connection details** → copier la **Pooled connection** (`postgres://…@ep-…-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`)
3. La conserver dans un gestionnaire de mots de passe ; ne jamais la coller dans un chat, un ticket ou git

## Étape 2 — Remettre le service en ligne immédiatement (bascule)

Render → service web → **Environment** → remplacer `DATABASE_URL` par l'URL Neon → **Save Changes** (redéploiement automatique).

- Le schéma (`lists`, `reservations`) est créé automatiquement au démarrage (`CREATE TABLE IF NOT EXISTS`).
- Vérifier : `https://andconcept-list.onrender.com/api/health` → `{"ok":true,…,"store":"postgres"}` ; dans les logs : `stockage: postgres`.

## Étape 3 — Copier les données (depuis votre ordinateur)

```bash
SOURCE_DATABASE_URL='<URL externe de l'ancienne base Render>' \
TARGET_DATABASE_URL='<URL Neon>' \
node server/migrate.js
```

- Sortie : compteurs uniquement (listes / articles / réservations) puis `VÉRIFICATION OK`. Les chaînes de connexion ne sont jamais affichées.
- Relancer la commande est **sans risque** (idempotent : upsert) — à faire une dernière fois juste avant toute nouvelle bascule pour rattraper les dernières écritures.
- `node server/migrate.js --verify-only` (avec les mêmes variables) compare les compteurs sans rien écrire.

## Cas particulier : base Render expirée (grâce de 14 jours)

Une base Postgres gratuite Render **expire 30 jours après sa création** et devient alors **inaccessible** ; Render supprime les données 14 jours plus tard. Pendant la grâce, la seule façon de relire les données est de passer temporairement la base en plan payant :

1. Dashboard Render → la base expirée → passer au plan payant le moins cher (Basic 256 Mo, ~6 $/mois, **facturation au prorata de la seconde**)
2. Attendre le statut **Available**, puis noter l'**External Database URL** (onglet Info)
3. Lancer l'étape 3 ci-dessus avec cette URL en `SOURCE_DATABASE_URL` (depuis votre ordinateur)
4. Vérifier (`VÉRIFICATION OK` + un lien partagé qui affiche l'ancienne liste), puis **supprimer la base payante** (Settings → Delete) pour stopper la facturation

Coût réel d'une récupération de quelques minutes : quelques centimes.

## Vérifications finales

- `/api/health` → `"store":"postgres"`
- Ouvrir un lien partagé existant sur un téléphone → liste + réservations visibles
- Test de réservation depuis le lien, puis annulation
- Console Neon → SQL Editor : `SELECT count(*) FROM lists;` correspond aux compteurs affichés par le script

## Nettoyage

Après quelques jours de stabilité, supprimer l'ancienne base Render (elle serait de toute façon supprimée automatiquement à la fin de la grâce). La version GitHub Pages et les applis installées ne changent pas.

## Rollback

Render → Environment → remettre l'ancienne valeur de `DATABASE_URL` → Save. Si des écritures ont eu lieu sur Neon entre-temps, relancer le script en sens inverse (`SOURCE`=Neon, `TARGET`=ancienne base).
