# Ara MCP Server — Audits RGAA via IA

Serveur MCP (Model Context Protocol) qui expose les opérations CRUD sur les audits d'accessibilité RGAA de la plateforme [Ara](https://ara.numerique.gouv.fr). Permet de piloter un audit Ara entièrement depuis Claude Code, Codex ou tout client MCP compatible — sans login manuel dans le navigateur.

> **Projet communautaire, non officiel.** Ce serveur est un client tiers de l'API d'[Ara](https://github.com/DISIC/Ara), le service d'audit d'accessibilité de la DINUM. Il n'est ni édité ni maintenu par la DINUM.

> **English** — An MCP server for [Ara](https://ara.numerique.gouv.fr), the French government platform for RGAA 4.1 accessibility audits. It exposes 14 tools to create, fill in, publish and export accessibility audits from any MCP client. Requires an account on ara.numerique.gouv.fr. Documentation is in French, matching the audience of the RGAA. Unofficial community project.

## Installation

Aucun clone nécessaire. Ajouter ce bloc à la configuration MCP de votre client :

```json
{
  "mcpServers": {
    "ara-rgaa": {
      "command": "npx",
      "args": ["-y", "ara-rgaa-mcp"],
      "env": {
        "ARA_AUTH_TOKEN": "votre-jwt-token"
      }
    }
  }
}
```

> Prérequis : Node.js ≥ 18 et un compte sur [ara.numerique.gouv.fr](https://ara.numerique.gouv.fr).

Pour Claude Code, le fichier est `~/.claude/claude_desktop_config.json`. Pour Codex ou Cursor, même format dans leurs réglages MCP respectifs.

## Authentification

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ARA_AUTH_TOKEN` | — | **Recommandé.** Token JWT pré-émis |
| `ARA_USERNAME` | — | Email, pour l'auto-login au démarrage |
| `ARA_PASSWORD` | — | Mot de passe, pour l'auto-login au démarrage |
| `ARA_BASE_URL` | `https://ara.numerique.gouv.fr/api` | URL de base de l'API Ara |

**Les identifiants ne sont jamais acceptés en paramètres d'outil.** Un paramètre d'outil transite par le contexte du modèle et se retrouve conservé dans les transcripts de conversation. Ils sont donc lus **uniquement** depuis l'environnement du processus, que votre client MCP renseigne depuis son propre fichier de configuration.

Préférez `ARA_AUTH_TOKEN` : le couple `ARA_USERNAME` / `ARA_PASSWORD` suppose d'écrire un mot de passe en clair dans un fichier de configuration. Si vous l'utilisez quand même, vérifiez les permissions du fichier et ne le versionnez pas.

L'outil `auth_refresh` rejoue l'authentification depuis l'environnement — utile quand un token a expiré en cours de session.

## Outils

Chaque outil porte des **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) qui permettent à votre client MCP de demander confirmation avant les opérations sensibles.

| Outil | Nature | Description |
|-------|--------|-------------|
| `auth_refresh` | ↻ | Rejoue l'authentification depuis l'environnement |
| `create_audit` | ✚ additif | Créer un nouvel audit |
| `duplicate_audit` | ✚ additif | Dupliquer un audit (la source n'est pas touchée) |
| `get_audit` | 🔒 lecture seule | Récupérer un audit complet |
| `get_audit_results` | 🔒 lecture seule | Tous les résultats de critères |
| `get_page_results` | 🔒 lecture seule | Résultats d'une page |
| `get_report` | 🔒 lecture seule | Rapport complet avec taux de conformité |
| `export_csv` | 🔒 lecture seule | Export CSV des résultats |
| `update_audit` | ⚠️ destructif | Mise à jour complète — **remplace** les métadonnées |
| `patch_audit_notes` | ⚠️ destructif | **Remplace** les notes de l'audit |
| `update_audit_results` | ⚠️ destructif | **Remplace** l'évaluation des critères visés |
| `update_statement` | ⚠️ destructif | **Remplace** la déclaration d'accessibilité |
| `publish_audit` | ⚠️ destructif | **Rend l'audit public** — à confirmer avec l'utilisateur |
| `delete_audit` | ⚠️ destructif | Suppression (soft delete, 410 ensuite) |

## Migration depuis la 1.x

La 2.0 supprime l'outil **`auth_signin`**, qui recevait l'e-mail et le mot de passe en paramètres — donc à travers le contexte du modèle.

- Retirez tout appel à `auth_signin` de vos scripts ou prompts.
- Mettez vos identifiants dans le bloc `env` de la configuration MCP (voir [Authentification](#authentification)) : le serveur s'authentifie tout seul au démarrage.
- `auth_refresh`, sans argument, remplace le besoin d'une reconnexion manuelle en cours de session.

Corrigé au passage : `signin` envoyait l'en-tête `Authorization` avec le jeton courant, ce qui faisait répondre `404 Cannot POST /api/auth/signin` à l'API dès que ce jeton était expiré — précisément le cas où l'on cherche à se reconnecter.

## Workflow typique

```
1. create_audit(FULL, "MonSite", pages...)   # Créer l'audit
2. get_audit(editUniqueId)                   # Vérifier les pages et IDs
3. update_audit_results(editUniqueId, [...]) # Remplir les critères RGAA
4. get_audit_results(editUniqueId)           # Vérifier les résultats
5. update_statement(editUniqueId, ...)       # Remplir la déclaration
6. publish_audit(editUniqueId)               # Publier l'audit terminé
7. get_report(consultUniqueId)               # Consulter le rapport final
```

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
| `GET` | `/audits/:uniqueId/pages/:slug` | `get_page_results` |
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
```

Pour brancher la copie locale sur un client MCP, pointer `command` sur `node` et `args` sur le chemin absolu de `build/index.js` — ou utiliser `run.sh`, qui fait le `cd` nécessaire à la résolution des `node_modules`.

## Licence

[EUPL-1.2](LICENSE) — Licence Publique de l'Union Européenne, la licence du projet [Ara](https://github.com/DISIC/Ara) amont.
