# AndConcept List 🎁

PWA de listes de cadeaux partagées, inspirée de l'esprit de la boutique [And Concept Store](https://andconceptstore.com/).

👉 **[Guide utilisateur](GUIDE.md)** — installation, création de liste, partage, réservation.

## Concept

- **Créateur** : crée une liste d'idées cadeaux (photo, nom, prix en saisie libre, magasin, précisions) et la partage par lien.
- **Amis / famille** : ouvrent le lien sans compte, **filtrent par budget** (≤ 20 €, ≤ 50 €, ou montant libre), et **réservent en secret** — la personne concernée ne sait jamais qui a réservé quoi.

## Deux modes de fonctionnement

| Mode | Comment | Particularité |
|---|---|---|
| **Autonome** (par défaut) | Ouvrir `index.html` hébergé statiquement | La liste est encodée dans le lien de partage. Zéro backend. Le lien ne se met pas à jour après partage. |
| **Serveur** (synchronisé) | `node server/server.js` | Listes persistées, réservations synchronisées entre tous les proches, le lien reste à jour. |

L'app détecte le backend automatiquement (`/api/health`) et bascule en mode autonome si absent.

## Lancer

```bash
node server/server.js          # http://localhost:3000
PORT=8080 node server/server.js
```

Zéro dépendance — Node ≥ 16 suffit. Les données sont dans `server/data.json`.

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | Vérifier la présence du backend |
| POST | `/api/lists` `{name}` | Créer une liste → `{id, adminToken}` |
| GET | `/api/lists/:id` | Voir la liste + `reservedIds` (jamais le nom des réservataires) |
| PUT | `/api/lists/:id` (header `X-Admin-Token`) | Modifier la liste (propriétaire uniquement) |
| DELETE | `/api/lists/:id` (header `X-Admin-Token`) | Supprimer la liste |
| POST | `/api/lists/:id/reserve` `{itemId, by}` | Réserver un article (secret, anti-doublon 409) |
| DELETE | `/api/lists/:id/reserve` `{itemId, secret}` | Annuler sa réservation |

## Structure

- `index.html`, `app.js`, `styles.css` — PWA (front)
- `manifest.json`, `icon*.svg`, `sw.js` — installation écran d'accueil + mode hors-ligne
- `server/server.js` — backend sans dépendance (Node http + fichier JSON)

## Confidentialité

Les réservations sont secrètes par conception : le nom du réservataire n'est jamais renvoyé au propriétaire de la liste, ni dans l'API ni dans le lien de partage.
