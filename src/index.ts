#!/usr/bin/env node

/**
 * Ara MCP Server
 *
 * A Model Context Protocol server that exposes CRUD operations on
 * Ara RGAA accessibility audits. Designed to be used with Claude Code,
 * Codex, or any MCP-compatible AI client.
 *
 * Credentials are NEVER accepted as tool arguments: they would transit
 * through the model's context and be persisted in conversation transcripts.
 * They are read from the process environment only, which the MCP client
 * populates from its own configuration file.
 *
 * Environment variables:
 *   ARA_BASE_URL   — Base URL of the Ara API (default: https://ara.numerique.gouv.fr/api)
 *   ARA_AUTH_TOKEN — Pre-issued Bearer token (recommended)
 *   ARA_USERNAME   — Account email, used for auto-login at startup
 *   ARA_PASSWORD   — Account password, used for auto-login at startup
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AraClient } from "./ara-client.js";

// ─── Configuration ────────────────────────────────────────

/** Keep in sync with the "version" field of package.json. */
const SERVER_VERSION = "2.1.0";

const ARA_BASE_URL =
  process.env.ARA_BASE_URL || "https://ara.numerique.gouv.fr/api";

const client = new AraClient({
  baseUrl: ARA_BASE_URL,
  authToken: process.env.ARA_AUTH_TOKEN,
});

// ─── MCP Server ───────────────────────────────────────────

/**
 * Build a server instance.
 *
 * `serveStdio` takes a factory rather than an instance: it negotiates the
 * protocol revision when the connection opens, and builds an instance pinned
 * to the era the client speaks. Tools are declared once and served to both.
 */
function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: "ara-rgaa-audits",
      version: SERVER_VERSION,
    },
    {
      // 2026-07-28 cache hints. The catalogue is static — it is compiled into
      // the package — so it is safe to cache for a while, and it holds nothing
      // user-specific, hence `public`. Without this the SDK emits a
      // conservative `ttlMs: 0, cacheScope: 'private'`, i.e. no caching.
      cacheHints: {
        "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "server/discover": { ttlMs: 3_600_000, cacheScope: "public" },
      },
    }
  );
  registerAllTools(server);
  return server;
}

// ─── Helpers ──────────────────────────────────────────────

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Annotation presets.
 *
 * `openWorldHint` is true everywhere: every tool talks to the remote Ara API.
 * `destructiveHint` marks the tools that overwrite or remove existing data —
 * this is how an MCP client knows it should ask the user for confirmation
 * before letting an agent run them.
 */
const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: true,
} as const;

const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

// ─── Authentication (environment only) ────────────────────

/**
 * Authenticate from the process environment.
 * Returns a human-readable status string; never returns or logs the token.
 *
 * `preferLogin` is set when refreshing an expired session: signing in again
 * is the only thing that can produce a fresh token, so credentials take
 * precedence over the static ARA_AUTH_TOKEN in that case. At startup the
 * precedence is reversed — the static token is used as-is.
 */
async function authenticateFromEnv(preferLogin = false): Promise<string> {
  const username = process.env.ARA_USERNAME;
  const password = process.env.ARA_PASSWORD;
  const canLogin = Boolean(username && password);
  const staticToken = process.env.ARA_AUTH_TOKEN;

  if (staticToken && !(preferLogin && canLogin)) {
    client.setAuthToken(staticToken);
    return preferLogin
      ? "Using the static token from ARA_AUTH_TOKEN. It cannot be refreshed: " +
          "issue a new token, or set ARA_USERNAME / ARA_PASSWORD to allow " +
          "signing in again."
      : "Using the static token from ARA_AUTH_TOKEN.";
  }

  if (!canLogin) {
    throw new Error(
      "No credentials configured. Set ARA_AUTH_TOKEN (recommended), or " +
        "ARA_USERNAME and ARA_PASSWORD, in the `env` block of this server's " +
        "entry in your MCP client configuration. Credentials are never " +
        "accepted as tool arguments."
    );
  }

  const token = await client.signin(username!, password!);
  client.setAuthToken(token);
  return "Re-authenticated from ARA_USERNAME / ARA_PASSWORD. Token refreshed.";
}

// ─── Tools ────────────────────────────────────────────────

/** Declare every tool on a server instance. Called once per instance built. */
function registerAllTools(server: McpServer): void {

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: auth_refresh
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "auth_refresh",
  {
    title: "Refresh the Ara session",
    description: `Re-authenticate against Ara using the credentials configured in this server's environment, and report the current authentication state.

Takes no arguments on purpose: credentials must never be passed as tool arguments, because tool arguments transit through the model's context and are persisted in conversation transcripts.

Configure them in the \`env\` block of your MCP client configuration:
- ARA_AUTH_TOKEN — a pre-issued Bearer token (recommended)
- ARA_USERNAME + ARA_PASSWORD — used to sign in automatically at startup

Use this tool only when a call has failed with an expired-token error.`,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    try {
      const message = await authenticateFromEnv(true);
      return textResult({ authenticated: client.isAuthenticated(), message });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: create_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "create_audit",
  {
    title: "Create an RGAA audit",
    description: `Create a new RGAA accessibility audit in Ara. Returns the audit with its editUniqueId (for editing) and consultUniqueId (for viewing the report).

Audit types:
- FULL: all 106 RGAA criteria
- FAST: 25 key criteria (audit rapide)
- COMPLEMENTARY: 50 criteria (audit complémentaire)`,
    inputSchema: z.object({
          auditType: z
            .enum(["FULL", "FAST", "COMPLEMENTARY"])
            .describe("Type of RGAA audit"),
          procedureName: z.string().describe("Name of the audited procedure/site"),
          pages: z
            .array(
              z.object({
                name: z.string().describe("Page name (e.g. 'Page d'accueil')"),
                url: z.string().describe("Page URL"),
              })
            )
            .describe("List of pages to audit"),
          auditorName: z.string().describe("Name of the auditor"),
          auditorEmail: z.string().optional().describe("Email of the auditor"),
          pageElements: z
            .object({
              multimedia: z.boolean().describe("Site contains multimedia elements"),
              form: z.boolean().describe("Site contains form elements"),
              table: z.boolean().describe("Site contains data tables"),
              frame: z.boolean().describe("Site contains iframes"),
            })
            .describe("Types of elements present on the site"),
        }),
    annotations: ADDITIVE,
  },
  async (args) => {
    try {
      const audit = await client.createAudit(args);
      return textResult({
        message: "Audit created successfully",
        editUniqueId: audit.editUniqueId,
        consultUniqueId: audit.consultUniqueId,
        procedureName: audit.procedureName,
        auditType: audit.auditType,
        pages: audit.pages,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: get_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "get_audit",
  {
    title: "Get an audit",
    description:
      "Retrieve a full audit by its editUniqueId. Returns all metadata, pages, environments, and notes.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
        }),
    annotations: READ_ONLY,
  },
  async ({ uniqueId }) => {
    try {
      const audit = await client.getAudit(uniqueId);
      return textResult(audit);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: update_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "update_audit",
  {
    title: "Update an audit (full replace)",
    description:
      "Full update of an audit's metadata (procedure info, auditor info, environments, tools, technologies, notes, etc.). This REPLACES the existing metadata: fetch the audit with get_audit first and resend the fields you want to keep.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
          auditType: z.enum(["FULL", "FAST", "COMPLEMENTARY"]),
          procedureName: z.string(),
          pages: z.array(
            z.object({
              id: z
                .number()
                .optional()
                .describe("Page ID (include to update existing page)"),
              name: z.string(),
              url: z.string(),
            })
          ),
          auditorName: z.string(),
          auditorEmail: z.string().optional(),
          procedureUrl: z.string().optional().describe("URL of the audited site"),
          initiator: z
            .string()
            .optional()
            .describe("Organisation requesting the audit"),
          auditorOrganisation: z.string().optional(),
          contactName: z.string().optional().describe("Accessibility contact name"),
          contactEmail: z
            .string()
            .optional()
            .describe("Accessibility contact email"),
          contactFormUrl: z
            .string()
            .optional()
            .describe("URL of accessibility contact form"),
          tools: z
            .array(z.string())
            .optional()
            .describe("Audit tools used (e.g. ['Axe', 'WAVE'])"),
          environments: z
            .array(
              z.object({
                platform: z.string().describe("e.g. 'Desktop' or 'Mobile'"),
                operatingSystem: z.string().describe("e.g. 'Windows', 'macOS'"),
                assistiveTechnology: z
                  .string()
                  .describe("e.g. 'JAWS', 'NVDA', 'VoiceOver'"),
                browser: z.string().describe("e.g. 'Firefox', 'Chrome'"),
              })
            )
            .optional()
            .describe("Test environments used"),
          technologies: z
            .array(z.string())
            .optional()
            .describe("Technologies used on the site (e.g. ['HTML', 'CSS', 'JavaScript'])"),
          notCompliantContent: z
            .string()
            .optional()
            .describe("Description of non-compliant content"),
          derogatedContent: z
            .string()
            .optional()
            .describe("Description of derogated content"),
          notInScopeContent: z
            .string()
            .optional()
            .describe("Description of content not in scope"),
          notes: z.string().optional().describe("General audit notes (rich text)"),
          transverseElements: z
            .string()
            .array()
            .optional()
            .describe("Transverse elements (e.g. ['En-tête', 'Pied de page'])"),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ uniqueId, ...data }) => {
    try {
      const audit = await client.updateAudit(uniqueId, data);
      return textResult({
        message: "Audit updated successfully",
        editUniqueId: audit.editUniqueId,
        procedureName: audit.procedureName,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: patch_audit_notes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "patch_audit_notes",
  {
    title: "Replace the audit notes",
    description:
      "Update only the notes field of an audit, without touching other metadata. The new content REPLACES the existing notes.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
          notes: z.string().describe("New notes content (rich text / HTML)"),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ uniqueId, notes }) => {
    try {
      await client.patchAudit(uniqueId, { notes });
      return textResult({ message: "Audit notes updated successfully" });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: delete_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "delete_audit",
  {
    title: "Delete an audit",
    description:
      "Soft-delete an audit. The audit will return HTTP 410 Gone for future requests. This cannot be undone from this server.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit to delete"),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ uniqueId }) => {
    try {
      await client.deleteAudit(uniqueId);
      return textResult({ message: "Audit deleted successfully" });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: duplicate_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "duplicate_audit",
  {
    title: "Duplicate an audit",
    description:
      "Fully duplicate an existing audit (metadata, pages, RGAA results, example images). Returns a new audit with fresh IDs. The source audit is left untouched.",
    inputSchema: z.object({
          uniqueId: z
            .string()
            .describe("The editUniqueId of the audit to duplicate"),
          procedureName: z.string().describe("Name for the duplicated audit"),
        }),
    annotations: ADDITIVE,
  },
  async ({ uniqueId, procedureName }) => {
    try {
      const audit = await client.duplicateAudit(uniqueId, procedureName);
      return textResult({
        message: "Audit duplicated successfully",
        newEditUniqueId: audit.editUniqueId,
        newConsultUniqueId: audit.consultUniqueId,
        procedureName: audit.procedureName,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: publish_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "publish_audit",
  {
    title: "Publish an audit (public)",
    description:
      "Mark an audit as published/completed. This makes the audit report and its accessibility statement PUBLICLY available at their consultation URL — confirm with the user before calling it. The audit must be fully filled in (all criteria evaluated) before publishing. Returns HTTP 409 if incomplete.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit to publish"),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ uniqueId }) => {
    try {
      const audit = await client.publishAudit(uniqueId);
      return textResult({
        message: "Audit published successfully",
        publicationDate: audit.publicationDate,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: get_audit_results
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "get_audit_results",
  {
    title: "Get all criterion results",
    description: `Retrieve all criterion results for an audit. Returns an array of results, each with:
- topic (1-13): RGAA topic number
- criterium: criterion number within the topic
- pageId: ID of the audited page
- status: COMPLIANT | NOT_COMPLIANT | NOT_APPLICABLE | NOT_TESTED
- compliantComment / notCompliantComment / notApplicableComment
- userImpact: MINOR | MAJOR | BLOCKING (when not compliant)
- quickWin: whether the fix is easy`,
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
        }),
    annotations: READ_ONLY,
  },
  async ({ uniqueId }) => {
    try {
      const results = await client.getResults(uniqueId);
      return textResult(results);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: update_audit_results
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "update_audit_results",
  {
    title: "Update criterion results",
    description: `Update criterion results for an audit. Send an array of result items.
Each item targets one criterion on one page using (pageId, topic, criterium), and REPLACES the previous evaluation of that criterion.

The topic/criterium must be a valid RGAA combination. Topics 1-13:
1. Images, 2. Cadres, 3. Couleurs, 4. Multimédia, 5. Tableaux,
6. Liens, 7. Scripts, 8. Éléments obligatoires, 9. Structuration,
10. Présentation, 11. Formulaires, 12. Navigation, 13. Consultation

Status values: COMPLIANT, NOT_COMPLIANT, NOT_APPLICABLE, NOT_TESTED
User impact values: MINOR, MAJOR, BLOCKING`,
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
          results: z
            .array(
              z.object({
                pageId: z.number().describe("ID of the page being evaluated"),
                topic: z
                  .number()
                  .min(1)
                  .max(13)
                  .describe("RGAA topic number (1-13)"),
                criterium: z
                  .number()
                  .min(1)
                  .describe("Criterion number within the topic"),
                status: z
                  .enum([
                    "COMPLIANT",
                    "NOT_COMPLIANT",
                    "NOT_APPLICABLE",
                    "NOT_TESTED",
                  ])
                  .describe("Evaluation result"),
                compliantComment: z
                  .string()
                  .optional()
                  .describe("Comment when criterion is compliant"),
                notCompliantComment: z
                  .string()
                  .optional()
                  .describe("Description of the non-compliance issue"),
                userImpact: z
                  .enum(["MINOR", "MAJOR", "BLOCKING"])
                  .optional()
                  .describe("User impact level when not compliant"),
                quickWin: z
                  .boolean()
                  .optional()
                  .describe("Whether this is easy to fix"),
                notApplicableComment: z
                  .string()
                  .optional()
                  .describe("Comment when criterion is not applicable"),
              })
            )
            .describe("Array of criterion results to update"),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ uniqueId, results }) => {
    try {
      await client.updateResults(uniqueId, results);
      return textResult({
        message: `Successfully updated ${results.length} criterion result(s)`,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: get_page_results
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "get_page_results",
  {
    title: "Get results for one page",
    description:
      "Get criterion results for a specific page of an audit. The pageSlug is typically the page order number.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
          pageSlug: z.string().describe("The page slug (usually its order number)"),
        }),
    annotations: READ_ONLY,
  },
  async ({ uniqueId, pageSlug }) => {
    try {
      const page = await client.getPageResults(uniqueId, pageSlug);
      return textResult(page);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: get_report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "get_report",
  {
    title: "Get the audit report",
    description:
      "Get the full audit report (read-only). Includes accessibility rate, criteria counts, and result distributions by page and topic. Uses the consultUniqueId (not the editUniqueId).",
    inputSchema: z.object({
          consultUniqueId: z
            .string()
            .describe("The consultUniqueId of the audit (found in the audit data)"),
        }),
    annotations: READ_ONLY,
  },
  async ({ consultUniqueId }) => {
    try {
      const report = await client.getReport(consultUniqueId);
      return textResult(report);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: update_statement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "update_statement",
  {
    title: "Update the accessibility statement",
    description:
      "Update the accessibility statement (déclaration d'accessibilité) for an audit. This is used to generate the public accessibility statement, and REPLACES the current statement fields.",
    inputSchema: z.object({
          editUniqueId: z.string().describe("The editUniqueId of the audit"),
          initiator: z
            .string()
            .optional()
            .describe("Organisation requesting the audit"),
          auditorOrganisation: z
            .string()
            .optional()
            .describe("Auditing organisation"),
          procedureUrl: z.string().optional().describe("URL of the audited site"),
          contactName: z.string().optional().describe("Accessibility contact name"),
          contactEmail: z
            .string()
            .optional()
            .describe("Accessibility contact email"),
          contactFormUrl: z
            .string()
            .optional()
            .describe("Accessibility contact form URL"),
          technologies: z.array(z.string()).optional().describe("Technologies used"),
          tools: z.array(z.string()).optional().describe("Audit tools used"),
          environments: z
            .array(
              z.object({
                platform: z.string(),
                operatingSystem: z.string(),
                assistiveTechnology: z.string(),
                browser: z.string(),
              })
            )
            .optional()
            .describe("Test environments"),
          notCompliantContent: z.string().optional(),
          derogatedContent: z.string().optional(),
          notInScopeContent: z.string().optional(),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ editUniqueId, ...data }) => {
    try {
      const audit = await client.updateStatement(editUniqueId, data);
      return textResult({
        message: "Statement updated successfully",
        editUniqueId: audit.editUniqueId,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: export_csv
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "export_csv",
  {
    title: "Export results as CSV",
    description: "Export audit results in CSV format.",
    inputSchema: z.object({
          uniqueId: z.string().describe("The editUniqueId of the audit"),
        }),
    annotations: READ_ONLY,
  },
  async ({ uniqueId }) => {
    try {
      const csv = await client.getCsvExport(uniqueId);
      return textResult(csv);
    } catch (err) {
      return errorResult(err);
    }
  }
);

} // fin de registerAllTools

// ─── Auto-login on startup ───────────────────────────────

async function autoLogin() {
  if (process.env.ARA_AUTH_TOKEN) {
    console.error("[ara-mcp] Using token from ARA_AUTH_TOKEN");
    return;
  }
  if (!process.env.ARA_USERNAME || !process.env.ARA_PASSWORD) {
    console.error(
      "[ara-mcp] No credentials in the environment. Set ARA_AUTH_TOKEN " +
        "(recommended) or ARA_USERNAME / ARA_PASSWORD in your MCP client config."
    );
    return;
  }
  try {
    await authenticateFromEnv();
    console.error("[ara-mcp] Auto-authenticated from ARA_USERNAME");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ara-mcp] Auto-login failed:", message);
  }
}

// ─── Start ────────────────────────────────────────────────

async function main() {
  await autoLogin();
  // Negotiates the protocol revision when the connection opens, and serves
  // both the 2025 era and 2026-07-28 from the same factory.
  serveStdio(() => buildServer());
  console.error("[ara-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[ara-mcp] Fatal error:", err);
  process.exit(1);
});
