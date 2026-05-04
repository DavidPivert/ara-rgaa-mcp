# Ara MCP Server — Audits RGAA via IA

Serveur MCP (Model Context Protocol) qui expose les opérations CRUD sur les audits d'accessibilité RGAA de la plateforme [Ara](https://ara.numerique.gouv.fr). Permet de piloter un audit Ara entièrement depuis Claude Code, Codex ou tout client MCP compatible — sans login manuel dans le navigateur.

## Cartographie des routes Ara

### Audits (`/audits`)

| Méthode | Route | Outil MCP | Description |
|---------|-------|-----------|-------------|
| `POST` | `/audits` | `create_audit` | Créer un nouvel audit |
| `GET` | `/audits/:uniqueId` | `get_audit` | Récupérer un audit complet |
| `PUT` | `/audits/:uniqueId` | `update_audit` | Mise à jour complète d'un audit |
| `PATCH` | `/audits/:uniqueId` | `patch_audit_notes` | Mettre à jour les notes uniquement |
| `DELETE` | `/audits/:uniqueId` | `delete_audit` | Supprimer un audit (soft delete) |
| `POST` | `/audits/:uniqueId/duplicate` | `duplicate_audit` | Dupliquer un audit |
| `PUT` | `/audits/:uniqueId/publish` | `publish_audit` | Publier un audit terminé |
| `GET` | `/audits/:uniqueId/results` | `get_audit_results` | Récupérer tous les résultats de critères |
| `PATCH` | `/audits/:uniqueId/results` | `update_audit_results` | Mettre à jour les résultats de critères (batch) |
| `GET` | `/audits/:uniqueId/pages/:slug` | `get_page_results` | Résultats par page |
| `GET` | `/audits/:uniqueId/exports/csv` | `export_csv` | Export CSV des résultats |
| `PUT` | `/audits/:editUniqueId/statement` | `update_statement` | Mettre à jour la déclaration d'accessibilité |

### Rapports (`/reports`) — lecture seule

| Méthode | Route | Outil MCP | Description |
|---------|-------|-----------|-------------|
| `GET` | `/reports/:consultUniqueId` | `get_report` | Rapport complet avec taux de conformité |

### Authentification (`/auth`)

| Méthode | Route | Outil MCP | Description |
|---------|-------|-----------|-------------|
| `POST` | `/auth/signin` | `auth_signin` | Authentification par email/mot de passe |

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

## Installation

```bash
git clone https://github.com/DavidPivert/ara-rgaa-mcp.git
cd ara-rgaa-mcp
npm install
npm run build
```

> Prérequis : Node.js ≥ 18 et un compte sur [ara.numerique.gouv.fr](https://ara.numerique.gouv.fr).

## Configuration

### Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ARA_BASE_URL` | `https://ara.numerique.gouv.fr/api` | URL de base de l'API Ara |
| `ARA_AUTH_TOKEN` | — | Token JWT pré-configuré (évite le login) |
| `ARA_USERNAME` | — | Email pour auto-login au démarrage |
| `ARA_PASSWORD` | — | Mot de passe pour auto-login au démarrage |

### Config Claude Code (recommandé)

Ajouter dans `~/.claude/claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "ara-rgaa": {
      "command": "bash",
      "args": ["/absolute/path/to/ara-rgaa-mcp/run.sh"],
      "env": {
        "ARA_BASE_URL": "https://ara.numerique.gouv.fr/api",
        "ARA_USERNAME": "votre-email@example.com",
        "ARA_PASSWORD": "votre-mot-de-passe"
      }
    }
  }
}
```

> **Important** : Le script `run.sh` fait un `cd` dans le dossier du projet avant de lancer Node, ce qui garantit la résolution correcte des `node_modules`. Ne pas appeler `node build/index.js` directement depuis un autre répertoire.

### Config alternative (mode dev avec `npx tsx`)

```json
{
  "mcpServers": {
    "ara-rgaa": {
      "command": "npx",
      "args": ["--prefix", "/absolute/path/to/ara-rgaa-mcp", "tsx", "src/index.ts"],
      "env": {
        "ARA_BASE_URL": "https://ara.numerique.gouv.fr/api",
        "ARA_AUTH_TOKEN": "votre-jwt-token"
      }
    }
  }
}
```

### Config Codex / Cursor

Même format — ajuster dans les réglages MCP de l'outil.

## Workflow typique

```
1. auth_signin(username, password)          # Ou auto-login via env vars
2. create_audit(FULL, "MonSite", pages...)  # Créer l'audit
3. get_audit(editUniqueId)                  # Vérifier les pages et IDs
4. update_audit_results(editUniqueId, [...]) # Remplir les critères RGAA
5. get_audit_results(editUniqueId)          # Vérifier les résultats
6. update_statement(editUniqueId, ...)      # Remplir la déclaration
7. publish_audit(editUniqueId)              # Publier l'audit terminé
8. get_report(consultUniqueId)              # Consulter le rapport final
```

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

## Licence

Même licence que le projet Ara (EUPL).
