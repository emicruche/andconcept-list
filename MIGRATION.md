# Migration de la base de données (Render → Neon/Supabase)

Objectif : déplacer les données vers un PostgreSQL gratuit permanent **sans qu'aucun utilisateur ne perde sa liste**.

## Pourquoi aucune liste n'est perdue

- Les listes sont copiées **avec le même `id` et le même `admin_token`** : les liens partagés (`#/s/srv:<id>`) et les aperçus WhatsApp (`/index.html?list=<id>`) continuent de fonctionner tels quels, et les propriétaires peuvent toujours modifier/supprimer leur liste (leur jeton dans le navigateur correspond toujours).
- Les réservations sont copiées telles quelles : les articles restent « réservés », la confidentialité (qui a réservé) est préservée.
- Les listes en mode autonome (GitHub Pages / lien encodé) vivent dans le navigateur ou dans le lien lui-même : elles ne dépendent d'aucune base et ne sont pas concernées.

## Procédure (zéro interruption)

1. **Créer la base cible** sur Neon (gratuit, permanent) → copier la chaîne de connexion *pooled* (elle finit par `-pooler.<region>.aws.neon.tech/...?sslmode=require`).
2. **Déployer ce dépôt sur Render** (le script `server/migrate.js` doit être présent).
3. **Copier les données** depuis le shell Render du service web (la source est `$DATABASE_URL`, aucune chaîne n'est affichée ni stockée) :

   ```bash
   TARGET_DATABASE_URL='postgres://...neon.tech/...?sslmode=require' node server/migrate.js
   ```

   Le script affiche uniquement des compteurs (listes / articles / réservations) et vérifie que la cible contient tout.
4. **Re-synchroniser juste avant la bascule** (récupère les dernières écritures) : relancer la même commande, puis **basculer immédiatement** :
   dans Render → service web → **Environment** → remplacer `DATABASE_URL` par la chaîne Neon → Save (redéploiement automatique).
5. **Vérifier** :
   - `GET https://andconcept-list.onrender.com/api/health` → doit renvoyer `"store":"postgres"`
   - ouvrir un lien partagé existant → la liste s'affiche avec ses réservations
   - `TARGET_DATABASE_URL='...' node server/migrate.js --verify-only` depuis le shell (avec `SOURCE_DATABASE_URL` = ancienne URL) pour confirmer les compteurs
6. **Garder l'ancienne base Render quelques jours** en secours (elle expire de toute façon à 30 jours), puis la supprimer.

## Commandes utiles

```bash
# Copie complète + idempotente (peut être relancé sans risque)
SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node server/migrate.js

# Vérification seule (aucune écriture)
SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node server/migrate.js --verify-only

# Sur le shell Render, la source est $DATABASE_URL par défaut :
TARGET_DATABASE_URL=... node server/migrate.js
```

Les chaînes de connexion se lisent uniquement dans les variables d'environnement ; elles ne sont jamais écrites dans les logs, les fichiers ni git.
