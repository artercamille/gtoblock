# gtoblock

Extension Chrome qui bloque les pubs : sites web, YouTube et Twitch (skip réel des pubs incrustées dans le live).

## Installation
1. `git clone https://github.com/artercamille/gtoblock.git`
2. Ouvre `chrome://extensions` et active le **Mode développeur**
3. **Charger l'extension non empaquetée** → choisis le dossier `gtoblock`

## Mise à jour
```
git pull
```
Puis ↻ sur gtoblock dans `chrome://extensions`, et recharge tes onglets.

## Réglages à distance
`config.json` est relu par l'extension au démarrage puis toutes les 6 h. Modifier ce fichier sur GitHub suffit, sans réinstaller :

| Clé | Rôle |
|---|---|
| `twitch.forcePlayerType` | Type de lecteur demandé pour le flux principal (`""` pour désactiver) |
| `twitch.backupTypes` | Types de lecteur essayés, dans l'ordre, pendant une pub |
| `twitch.adMarker` | Texte qui signale une pub dans la playlist Twitch |

## Alerte
Si une pub passe malgré tout, l'icône affiche **!TW** (Twitch) ou **!YT** (YouTube) : le site a changé quelque chose, il faut une mise à jour.
