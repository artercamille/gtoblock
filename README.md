# gtoblock

Extension Chrome qui bloque les pubs : sites web, YouTube et Twitch (skip réel des pubs incrustées dans le live).

**Elle se met à jour toute seule** : toutes les heures et à chaque démarrage de Chrome, elle récupère sur ce dépôt les derniers scripts, la liste des régies bloquées et les réglages. Pousser sur `main` suffit, personne n'a rien à réinstaller.

## Installation (une seule fois)
1. Télécharge le dépôt (bouton **Code → Download ZIP**) et dézippe-le
2. Ouvre `chrome://extensions` et active le **Mode développeur**
3. **Charger l'extension non empaquetée** → choisis le dossier
4. Dans **Détails** de gtoblock, active **« Autoriser les scripts utilisateur »** (le popup de l'extension te guide)

## Comment marche la mise à jour
| Fichier | Mis à jour automatiquement |
|---|---|
| `content.js`, `youtube.js`, `twitch.js`, `twitch-main.js` | ✅ (exécutés via l'API userScripts de Chrome) |
| `rules.json` | ✅ (appliqué en règles dynamiques) |
| `config.json` | ✅ |
| `background.js`, `popup.*`, `manifest.json` | ❌ (le « moteur » de mise à jour, il ne change pas) |

Si GitHub est injoignable, l'extension garde la dernière version connue. Si les scripts utilisateur ne sont pas autorisés, elle tourne avec ses fichiers locaux.

## Réglages (`config.json`)
| Clé | Rôle |
|---|---|
| `twitch.forcePlayerType` | Type de lecteur demandé pour le flux principal (`""` pour désactiver) |
| `twitch.backupTypes` | Types de lecteur essayés, dans l'ordre, pendant une pub |
| `twitch.adMarker` | Texte qui signale une pub dans la playlist Twitch |

## Alerte
Si une pub passe malgré tout, l'icône affiche **!TW** (Twitch) ou **!YT** (YouTube) : le site a changé quelque chose, il faut pousser une correction.
