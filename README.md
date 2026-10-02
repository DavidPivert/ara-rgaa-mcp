# Ara MCP Server — Audits RGAA via IA

Serveur MCP (Model Context Protocol) qui expose les opérations CRUD sur les audits d'accessibilité RGAA de la plateforme [Ara](https://ara.numerique.gouv.fr). Permet de piloter un audit Ara entièrement depuis Claude Code, Codex ou tout client MCP compatible — sans login manuel dans le navigateur.

> **Projet communautaire, non officiel.** Ce serveur est un client tiers de l'API d'[Ara](https://github.com/DISIC/Ara), le service d'audit d'accessibilité de la DINUM. Il n'est ni édité ni maintenu par la DINUM.

> **English** — An MCP server for [Ara](https://ara.numerique.gouv.fr), the French government platform for RGAA 4.1 accessibility audits. It exposes 17 tools to create, fill in, publish and export accessibility audits from any MCP client. Requires an account on ara.numerique.gouv.fr. Documentation is in French, matching the audience of the RGAA. Unofficial community project.

## Installation

**1. Se connecter, une fois :**

```bash
npx ara-rgaa-mcp login
```

Une page s'ouvre dans votre navigateur, sur votre propre ordinateur. Vous y saisissez vos identifiants Ara ; le jeton est enregistré dans `~/.config/ara-rgaa-mcp/credentials.json`, en permissions `600`. **Votre mot de passe n'est jamais enregistré.**

**2. Déclarer le serveur — sans aucun secret dans la configuration :**

```json
{
  "mcpServers": {
    "ara-rgaa": {
      "command": "npx",
      "args": ["-y", "ara-rgaa-mcp"]
    }
  }
}
```

> Prérequis : Node.js ≥ 18 et un compte sur [ara.numerique.gouv.fr](https://ara.numerique.gouv.fr).

Pour Claude Code, le fichier est `~/.claude/claude_desktop_config.json`. Pour Codex ou Cursor, même format dans leurs réglages MCP respectifs.

**Le renouvellement est automatique.** Les jetons d'Ara durent 24 h, mais le serveur en demande un neuf à chaque démarrage : un usage régulier ne redemande jamais de se connecter. Après plus de 24 h sans usage, le serveur vous dit de relancer `login`.

| Commande | |
|---|---|
| `npx ara-rgaa-mcp login` | Se connecter et enregistrer le jeton |
| `npx ara-rgaa-mcp status` | Compte, instance, âge du jeton |
| `npx ara-rgaa-mcp logout` | Supprimer le jeton enregistré |

<details>
<summary>Sécurité de la page de connexion</summary>

Une page locale qui réclame des identifiants ressemble à du hameçonnage : le serveur prend donc quatre précautions.

- Il écoute **uniquement sur `127.0.0.1`**, jamais sur une interface réseau.
- L'URL comporte un **jeton aléatoire** qu'une autre page locale ne peut pas deviner ; toute autre adresse renvoie 404.
- Elle est **à usage unique** : le serveur s'arrête dès la connexion réussie.
- L'**URL exacte est affichée dans le terminal** — comparez-la à celle du navigateur avant de saisir quoi que ce soit.

Votre mot de passe ne transite que du navigateur vers ce processus local, puis vers `ara.numerique.gouv.fr`. Il n'est écrit nulle part.

Si vous n'avez pas lancé la commande vous-même, fermez la page.
</details>

## Authentification par variables d'environnement

Alternative à `login`, pour l'automatisation ou les environnements sans navigateur.

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ARA_AUTH_TOKEN` | — | Jeton JWT. **⚠️ Valable 24 h seulement** |
| `ARA_USERNAME` | — | Email, pour l'authentification au démarrage |
| `ARA_PASSWORD` | — | Mot de passe, pour l'authentification au démarrage |
| `ARA_BASE_URL` | `https://ara.numerique.gouv.fr/api` | URL de base de l'API Ara |

**Les identifiants ne sont jamais acceptés en paramètres d'outil.** Un paramètre d'outil transite par le contexte du modèle et se retrouve conservé dans les transcripts de conversation. Ils sont donc lus **uniquement** depuis l'environnement du processus ou depuis le fichier écrit par `login`.

> **⚠️ `ARA_AUTH_TOKEN` expire au bout de 24 heures.** Les jetons d'Ara sont signés avec `expiresIn: "24h"` : un jeton collé à la main cesse de fonctionner le lendemain. Ne l'utilisez que pour une intégration automatisée qui sait le renouveler. Pour un usage quotidien, préférez `login` ci-dessus, ou à défaut `ARA_USERNAME` / `ARA_PASSWORD` — qui suppose en revanche d'écrire un mot de passe en clair dans un fichier de configuration.

L'outil `auth_refresh` rejoue l'authentification en cours de session, si un jeton a expiré.

## Outils

Chaque outil porte des **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) qui permettent à votre client MCP de demander confirmation avant les opérations sensibles.

| Outil | Nature | Description |
|-------|--------|-------------|
| `get_audit_method` | 📖 référentiel | **Plan de travail** : quels critères exigent quoi |
| `list_rgaa_criteria` | 📖 référentiel | Index des critères RGAA (numéro + intitulé), filtrable |
| `get_rgaa_criterion` | 📖 référentiel | Un critère, **ses tests** et ce qu'il faut pour le vérifier |
| `auth_refresh` | ↻ | Rejoue l'authentification depuis l'environnement |
| `create_audit` | ✚ additif | Créer un nouvel audit |
| `duplicate_audit` | ✚ additif | Dupliquer un audit pour un retest, **fiche comprise** (la source n'est pas touchée) |
| `get_audit` | 🔒 lecture seule | Récupérer un audit complet |
| `get_audit_progress` | 🔒 lecture seule | **Avancement** : ce qui reste à évaluer, par page |
| `compare_audits` | 🔒 lecture seule | **Retest** : taux avant/après, critères et résultats qui ont changé |
| `get_audit_results` | 🔒 lecture seule | Résultats de critères, filtrables par page et par statut |
| `get_report` | 🔒 lecture seule | Rapport complet avec taux de conformité |
| `export_csv` | 🔒 lecture seule | Export CSV des résultats |
| `update_audit` | ⚠️ destructif | Mise à jour complète — **remplace** les métadonnées |
| `patch_audit_notes` | ⚠️ destructif | **Remplace** les notes de l'audit |
| `update_audit_results` | ⚠️ destructif | **Remplace** l'évaluation des critères visés |
| `update_statement` | ⚠️ destructif | **Remplace ET publie** la déclaration d'accessibilité |
| `publish_audit` | ⚠️ destructif | **Rend l'audit public — irréversible** (voir ci-dessous) |
| `delete_audit` | ⚠️ destructif | Suppression (410 ensuite) — **ne dépublie pas** |

## Retest après correctifs

Le cycle conseillé : audit initial, correctifs, **copie** de l'audit, retest des critères touchés, déclaration depuis la copie.

- **`duplicate_audit` recopie la fiche.** La duplication d'Ara laisse vides le demandeur, l'organisation de l'auditeur, l'URL, le contact, les technologies et les outils (vérifié sur l'API). Le serveur les reprend de la source, en gardant les pages dans l'ordre de la source. Passer `copyMetadata: false` pour s'en tenir à la copie d'Ara. Si cette seconde étape échoue, la copie existe quand même : ses identifiants sont renvoyés avec un avertissement.
- **`update_audit` renumérote les pages dans l'ordre du tableau envoyé.** Renvoyer les pages triées par `order` (celui de `get_audit`), sinon l'échantillon est réordonné dans le rapport.
- **`compare_audits`** confronte l'audit initial et sa copie. Les pages sont appariées par nom et URL. Il renvoie le taux de chaque audit calculé selon la règle d'Ara (non conforme sur une page = non conforme ; conforme sur au moins une page et non conforme nulle part = conforme ; taux = conformes / applicables), les critères dont le statut a changé et les transitions page par page (NC→C, C→NC…).

## Envoi des résultats par paquets

`update_audit_results` envoie les résultats à Ara par paquets de 20 (`batchSize`, de 1 à 100). Ara répond parfois 500 à un paquet dont chaque résultat passe seul (constaté sur des paquets de 23 à 36 résultats des thématiques 10 et 12). Le serveur coupe alors le paquet en deux, jusqu'au résultat isolé :

- les résultats acceptés sont enregistrés ;
- ceux qu'Ara refuse même seuls sont listés dans `echecs` ;
- une erreur 4xx arrête l'envoi et indique combien de résultats étaient déjà enregistrés.

Chaque envoi remplace l'évaluation visée : renvoyer un paquet est sans effet de bord.

## Le référentiel RGAA embarqué

Le serveur embarque le **référentiel RGAA 4.1 complet** — 13 thématiques, 106 critères, et les **tests** de chacun. Sans lui, un agent ne manipule que des numéros (`topic: 6, criterium: 1`) sans savoir ce qu'il évalue.

```
list_rgaa_criteria(auditType: "FAST")   → les 25 critères de l'audit rapide (~5 Ko)
get_rgaa_criterion(topic: 6, criterium: 1)
  → « Chaque lien est-il explicite (hors cas particuliers) ? » + ses 5 tests (~2 Ko)
```

Le geste attendu pendant un audit : `get_rgaa_criterion` pour lire le critère et ses tests, puis `update_audit_results` pour poser le verdict. Juger plutôt que deviner.

Les données proviennent de [`rgaa.json`](https://github.com/DISIC/Ara/blob/main/confiture-rest-api/src/rgaa.json) du projet Ara, publié par la **DINUM** sous **[Licence Ouverte 2.0](https://github.com/DISIC/Ara/blob/main/LICENCES.md)**. Elles sont embarquées dans le paquet — le serveur fonctionne donc hors ligne, sans appel réseau pour la partie référentiel. Régénération : `node scripts/build-rgaa-data.mjs`.

> À noter : les types d'audit `FAST` et `COMPLEMENTARY` couvrent **25 critères chacun** et sont **disjoints** ; c'est la méthodologie complète (rapide + complémentaire) qui en couvre 50.

## Le code source ne suffit pas

Sur les 106 critères du RGAA, **40 seulement se tranchent en lisant le HTML** — et 6 sur les 25 d'un audit rapide. Les autres exigent la page rendue, une navigation clavier réelle, l'arbre d'accessibilité, ou un jugement éditorial.

C'est le piège de l'audit assisté par IA : un agent lit du balisage, y trouve des réponses plausibles, et remplit un audit qui ne repose sur rien. Trois mécanismes s'y opposent.

**`get_audit_method(auditType)`** — le plan de travail avant de commencer : quels critères relèvent du source, du rendu, du clavier, de la restitution, du jugement.

**`get_rgaa_criterion`** joint à chaque critère un bloc `verification` : `sourceSuffit`, les besoins, et comment s'y prendre.

**`update_audit_results` refuse un verdict non fondé.** Déclarer CONFORME ou NON CONFORME sur un critère qui exige davantage, sans renseigner le champ `evidence` correspondant, produit une erreur explicite :

```
Verdict refusé sur 1 critère(s) : le code source ne suffit pas à les trancher,
et la vérification correspondante n'a pas été déclarée.

  10.7 — exige : clavier (…) ; rendu (…)

Effectuez réellement ces vérifications, puis renseignez le champ "evidence".
Si vous ne pouvez pas les faire, utilisez le statut NOT_TESTED plutôt qu'un
verdict non fondé.
```

`NOT_TESTED` et `NOT_APPLICABLE` en sont dispensés : ils n'affirment rien. Et `evidence` reste déclaratif — un agent peut mentir, mais plus par omission.

> Cette classification est une **guidance de ce serveur**, déduite du vocabulaire des tests puis corrigée à la main. Le RGAA dit quoi vérifier, pas avec quel outil.

## ⚠️ Publier est irréversible

Ara n'offre aucune dépublication, et **supprimer un audit ne retire pas son rapport publié** :

| Après `publish_audit` puis `delete_audit` | |
|---|---|
| `GET /audits/:editUniqueId` | `410 Gone` — l'audit disparaît de votre liste |
| `GET /reports/:consultUniqueId` | **`200`** — le rapport reste publiquement lisible |

Le rapport devient alors inaccessible depuis l'interface d'Ara : vous ne pouvez plus ni le consulter, ni le corriger, ni le retirer. Seul votre nom d'auditeur disparaît du rapport public ; le contenu de l'audit demeure.

Deux conséquences pratiques :

- ne traitez jamais la suppression comme un moyen d'annuler une publication ;
- publier un audit portant sur un site tiers met en ligne **une déclaration d'accessibilité le concernant, signée de vous** — assurez-vous d'en avoir le mandat.

## Citer du HTML dans un commentaire

Ara **affiche les commentaires de critère en texte riche** : un `<th>` écrit tel quel est interprété comme une balise et disparaît du commentaire rendu — l'API répond 200, le constat perd sa substance, et rien ne le signale.

Depuis la 2.2.1, `update_audit_results` **échappe `<` et `>`** dans `compliantComment`, `notApplicableComment` et le `title`/`comment` de chaque `notCompliantItems`. Citez donc le balisage librement :

```
"comment": "Le champ n'a ni <label for>, ni aria-label."
      ↳ affiché dans Ara :  Le champ n'a ni <label for>, ni aria-label.
```

N'échappez pas vous-même : `&` est laissé intact, donc un `&lt;th&gt;` déjà échappé reste correct.

**Exception : le champ `notes`** (`patch_audit_notes`) reste du texte riche non échappé — c'est le champ prévu pour la mise en forme. Pour y citer du balisage, écrivez `&lt;th&gt;`.

## Révisions de protocole MCP

Depuis la 2.1.0, le serveur sert **les deux révisions de la spécification** depuis le même code, en négociant à l'ouverture de la connexion :

- **`2025-11-25`** — poignée de main `initialize`, comme avant.
- **`2026-07-28`** — sans état : plus de `initialize`, `server/discover`, `resultType`, et des indices de cache (`ttlMs` / `cacheScope`) sur le catalogue d'outils.

Il n'y a rien à configurer : votre client obtient la révision qu'il sait parler.

## Migration depuis la 1.x

La 2.0 supprime l'outil **`auth_signin`**, qui recevait l'e-mail et le mot de passe en paramètres — donc à travers le contexte du modèle.

- Retirez tout appel à `auth_signin` de vos scripts ou prompts.
- Mettez vos identifiants dans le bloc `env` de la configuration MCP (voir [Authentification](#authentification)) : le serveur s'authentifie tout seul au démarrage.
- `auth_refresh`, sans argument, remplace le besoin d'une reconnexion manuelle en cours de session.

Corrigé au passage : `signin` envoyait l'en-tête `Authorization` avec le jeton courant, ce qui faisait répondre `404 Cannot POST /api/auth/signin` à l'API dès que ce jeton était expiré — précisément le cas où l'on cherche à se reconnecter.

## Workflow typique

```
1. get_audit_method("FULL")                  # De quoi aurai-je besoin ?
2. create_audit(FULL, "MonSite", pages...)   # Créer l'audit (106 critères)
3. get_audit(editUniqueId)                   # Récupérer les IDs de page
4. get_rgaa_criterion(topic, criterium)      # Lire le critère et ses tests
5. update_audit_results(...)                 # Poser le verdict (envoi par paquets)
6. get_audit_progress(editUniqueId)          # Que reste-t-il ?
   ↳ revenir en 4 tant qu'il reste des critères
7. update_statement(editUniqueId, ...)       # Remplir la déclaration
8. publish_audit(editUniqueId)               # Publier l'audit terminé
9. get_report(consultUniqueId)               # Consulter le rapport final

Retest : duplicate_audit (fiche comprise) → update_audit_results sur la copie
         → compare_audits(initial, copie) → update_statement sur la copie
```

**L'audit complet est le cas normal** : seul un audit sur les 106 critères fonde une déclaration d'accessibilité. `FAST` (25 critères) et `COMPLEMENTARY` (25 autres) servent à repérer, pas à déclarer.

Un audit complet, c'est **106 critères par page, éléments transverses compris** — 318 résultats pour deux pages, près d'un millier sur un échantillon de huit. D'où la boucle 4→6 : évaluer par lots, puis demander ce qu'il reste avec `get_audit_progress` plutôt que de rapatrier tous les résultats.

L'authentification est faite au démarrage du serveur depuis l'environnement : aucune étape de login dans le workflow.

## Enums RGAA

### Types d'audit
- `FULL` — 106 critères (audit complet)
- `FAST` — 25 critères (audit rapide)
- `COMPLEMENTARY` — 50 critères (audit complémentaire)

### Statuts de critère
- `COMPLIANT` — Conforme
- `NOT_COMPLIANT` — Non conforme
- `NOT_APPLICABLE` — Non applicable
- `NOT_TESTED` — Non testé

### Impact utilisateur
- `MINOR` — Mineur
- `MAJOR` — Majeur
- `BLOCKING` — Bloquant

### Thématiques RGAA (topics 1-13)
1. Images
2. Cadres
3. Couleurs
4. Multimédia
5. Tableaux
6. Liens
7. Scripts
8. Éléments obligatoires
9. Structuration de l'information
10. Présentation de l'information
11. Formulaires
12. Navigation
13. Consultation

## Cartographie des routes Ara

### Audits (`/audits`)

| Méthode | Route | Outil MCP |
|---------|-------|-----------|
| `POST` | `/audits` | `create_audit` |
| `GET` | `/audits/:uniqueId` | `get_audit` |
| `PUT` | `/audits/:uniqueId` | `update_audit` |
| `PATCH` | `/audits/:uniqueId` | `patch_audit_notes` |
| `DELETE` | `/audits/:uniqueId` | `delete_audit` |
| `POST` | `/audits/:uniqueId/duplicate` | `duplicate_audit` |
| `PUT` | `/audits/:uniqueId/publish` | `publish_audit` |
| `GET` | `/audits/:uniqueId/results` | `get_audit_results` |
| `PATCH` | `/audits/:uniqueId/results` | `update_audit_results` |
| `GET` | `/audits/:uniqueId/exports/csv` | `export_csv` |
| `PUT` | `/audits/:editUniqueId/statement` | `update_statement` |

### Rapports (`/reports`) — lecture seule

| Méthode | Route | Outil MCP |
|---------|-------|-----------|
| `GET` | `/reports/:consultUniqueId` | `get_report` |

### Authentification (`/auth`)

| Méthode | Route | Outil MCP |
|---------|-------|-----------|
| `POST` | `/auth/signin` | `auth_refresh` (environnement uniquement) |

### Routes non exposées (hors périmètre MCP)

| Route | Raison |
|-------|--------|
| `GET /audits/:id/pages/:slug` | Le `slug` est une colonne unique par audit qu'**aucune réponse d'API ne renvoie** — ni l'ordre ni l'identifiant de page ne la résolvent. Utiliser `get_audit_results` et filtrer sur `pageId` |
| `POST /audits/:id/results/examples` | Upload d'image (deprecated) |
| `POST /audits/:id/notes/files` | Upload de fichier |
| `POST /audits/editor/images` | Upload d'image éditeur |
| `DELETE /audits/:id/results/examples/:id` | Suppression image |
| `DELETE /audits/:id/notes/files/:id` | Suppression fichier |
| `GET /audits` | Liste d'audits (nécessite auth account) |
| `POST /auth/signup` | Création de compte |
| `POST /auth/verify` | Vérification de compte |
| `PATCH /profile` | Profil utilisateur |
| `POST /feedback` | Retour utilisateur |

## Développement

```bash
git clone https://github.com/DavidPivert/ara-rgaa-mcp.git
cd ara-rgaa-mcp
npm install
npm run build      # compile vers build/
npm run typecheck  # tsc --noEmit
npm test           # tests hors ligne (envoi par paquets, fiche, comparaison), après le build
```

**Publication.** Le paquet est publié sur npm par GitHub Actions (`.github/workflows/publier.yml`) en « publication de confiance » (OIDC), sans jeton ni clé, avec une attestation d'origine. Pour une nouvelle version : monter la version dans `package.json` et `server.json`, fusionner dans `main`, puis pousser le tag `vX.Y.Z`. Le workflow refuse un tag qui ne correspond pas à `package.json` et ne republie pas une version déjà en ligne. Le bouton « Run workflow » publie la version de `package.json` si elle manque.

Pour brancher la copie locale sur un client MCP, pointer `command` sur `node` et `args` sur le chemin absolu de `build/index.js` — ou utiliser `run.sh`, qui fait le `cd` nécessaire à la résolution des `node_modules`.

## Licence

[EUPL-1.2](LICENSE) — Licence Publique de l'Union Européenne, pour le code de ce dépôt.

Le référentiel RGAA embarqué (`src/rgaa-data.ts`) est extrait du projet [Ara](https://github.com/DISIC/Ara) et reste sous **Licence Ouverte 2.0** — Direction interministérielle du numérique (DINUM).

Ce serveur est un projet indépendant : il consomme l'API d'[Ara](https://github.com/DISIC/Ara) sans en reprendre le code. Ara est publié par la DINUM sous [licence MIT](https://github.com/DISIC/Ara/blob/main/LICENCES.md), qui n'impose aucune contrainte sur la licence de ce dépôt.
