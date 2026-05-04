#!/usr/bin/env node

/**
 * Ara MCP Server
 *
 * A Model Context Protocol server that exposes CRUD operations on
 * Ara RGAA accessibility audits. Designed to be used with Claude Code,
 * Codex, or any MCP-compatible AI client.
 *
 * Environment variables:
 *   ARA_BASE_URL  — Base URL of the Ara API (default: https://ara.numerique.gouv.fr/api)
 *   ARA_AUTH_TOKEN — Optional pre-configured Bearer token
 *   ARA_USERNAME   — Optional username for auto-login
 *   ARA_PASSWORD   — Optional password for auto-login
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AraClient } from "./ara-client.js";

// ─── Configuration ────────────────────────────────────────

const ARA_BASE_URL =
  process.env.ARA_BASE_URL || "https://ara.numerique.gouv.fr/api";

const client = new AraClient({
  baseUrl: ARA_BASE_URL,
  authToken: process.env.ARA_AUTH_TOKEN,
});

// ─── MCP Server ───────────────────────────────────────────

const server = new McpServer({
  name: "ara-rgaa-audits",
  version: "1.0.0",
});

// ─── Helper ───────────────────────────────────────────────

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: auth_signin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "auth_signin",
  "Authenticate to the Ara platform using email/password. Returns a JWT token that will be used for all subsequent requests. Required only if ARA_AUTH_TOKEN is not set.",
  {
    username: z.string().describe("Your Ara account email"),
    password: z.string().describe("Your Ara account password"),
  },
  async ({ username, password }) => {
    try {
      const token = await client.signin(username, password);
      client.setAuthToken(token);
      return textResult({
        success: true,
        message: "Authenticated successfully. Token is now active for all subsequent calls.",
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: create_audit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "create_audit",
  `Create a new RGAA accessibility audit in Ara. Returns the audit with its editUniqueId (for editing) and consultUniqueId (for viewing the report).

Audit types:
- FULL: all 106 RGAA criteria
- FAST: 25 key criteria (audit rapide)
- COMPLEMENTARY: 50 criteria (audit complémentaire)`,
  {
    auditType: z.enum(["FULL", "FAST", "COMPLEMENTARY"]).describe("Type of RGAA audit"),
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

server.tool(
  "get_audit",
  "Retrieve a full audit by its editUniqueId. Returns all metadata, pages, environments, and notes.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit"),
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

server.tool(
  "update_audit",
  "Full update of an audit's metadata (procedure info, auditor info, environments, tools, technologies, notes, etc.).",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit"),
    auditType: z.enum(["FULL", "FAST", "COMPLEMENTARY"]),
    procedureName: z.string(),
    pages: z.array(
      z.object({
        id: z.number().optional().describe("Page ID (include to update existing page)"),
        name: z.string(),
        url: z.string(),
      })
    ),
    auditorName: z.string(),
    auditorEmail: z.string().optional(),
    procedureUrl: z.string().optional().describe("URL of the audited site"),
    initiator: z.string().optional().describe("Organisation requesting the audit"),
    auditorOrganisation: z.string().optional(),
    contactName: z.string().optional().describe("Accessibility contact name"),
    contactEmail: z.string().optional().describe("Accessibility contact email"),
    contactFormUrl: z.string().optional().describe("URL of accessibility contact form"),
    tools: z.array(z.string()).optional().describe("Audit tools used (e.g. ['Axe', 'WAVE'])"),
    environments: z
      .array(
        z.object({
          platform: z.string().describe("e.g. 'Desktop' or 'Mobile'"),
          operatingSystem: z.string().describe("e.g. 'Windows', 'macOS'"),
          assistiveTechnology: z.string().describe("e.g. 'JAWS', 'NVDA', 'VoiceOver'"),
          browser: z.string().describe("e.g. 'Firefox', 'Chrome'"),
        })
      )
      .optional()
      .describe("Test environments used"),
    technologies: z.array(z.string()).optional().describe("Technologies used on the site (e.g. ['HTML', 'CSS', 'JavaScript'])"),
    notCompliantContent: z.string().optional().describe("Description of non-compliant content"),
    derogatedContent: z.string().optional().describe("Description of derogated content"),
    notInScopeContent: z.string().optional().describe("Description of content not in scope"),
    notes: z.string().optional().describe("General audit notes (rich text)"),
    transverseElements: z.string().array().optional().describe("Transverse elements (e.g. ['En-tête', 'Pied de page'])"),
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

server.tool(
  "patch_audit_notes",
  "Update only the notes field of an audit. Useful for adding audit observations without touching other metadata.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit"),
    notes: z.string().describe("New notes content (rich text / HTML)"),
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

server.tool(
  "delete_audit",
  "Soft-delete an audit. The audit will return HTTP 410 Gone for future requests.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit to delete"),
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

server.tool(
  "duplicate_audit",
  "Fully duplicate an existing audit (metadata, pages, RGAA results, example images). Returns a new audit with fresh IDs.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit to duplicate"),
    procedureName: z.string().describe("Name for the duplicated audit"),
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

server.tool(
  "publish_audit",
  "Mark an audit as published/completed. The audit must be fully filled in (all criteria evaluated) before publishing. Returns HTTP 409 if incomplete.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit to publish"),
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

server.tool(
  "get_audit_results",
  `Retrieve all criterion results for an audit. Returns an array of results, each with:
- topic (1-13): RGAA topic number
- criterium: criterion number within the topic
- pageId: ID of the audited page
- status: COMPLIANT | NOT_COMPLIANT | NOT_APPLICABLE | NOT_TESTED
- compliantComment / notCompliantComment / notApplicableComment
- userImpact: MINOR | MAJOR | BLOCKING (when not compliant)
- quickWin: whether the fix is easy`,
  {
    uniqueId: z.string().describe("The editUniqueId of the audit"),
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

server.tool(
  "update_audit_results",
  `Update criterion results for an audit. Send an array of result items.
Each item targets one criterion on one page using (pageId, topic, criterium).

The topic/criterium must be a valid RGAA combination. Topics 1-13:
1. Images, 2. Cadres, 3. Couleurs, 4. Multimédia, 5. Tableaux,
6. Liens, 7. Scripts, 8. Éléments obligatoires, 9. Structuration,
10. Présentation, 11. Formulaires, 12. Navigation, 13. Consultation

Status values: COMPLIANT, NOT_COMPLIANT, NOT_APPLICABLE, NOT_TESTED
User impact values: MINOR, MAJOR, BLOCKING`,
  {
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
            .enum(["COMPLIANT", "NOT_COMPLIANT", "NOT_APPLICABLE", "NOT_TESTED"])
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

server.tool(
  "get_page_results",
  "Get criterion results for a specific page of an audit. The pageSlug is typically the page order number.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit"),
    pageSlug: z.string().describe("The page slug (usually its order number)"),
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

server.tool(
  "get_report",
  "Get the full audit report (read-only). Includes accessibility rate, criteria counts, and result distributions by page and topic. Uses the consultUniqueId (not the editUniqueId).",
  {
    consultUniqueId: z
      .string()
      .describe("The consultUniqueId of the audit (found in the audit data)"),
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

server.tool(
  "update_statement",
  "Update the accessibility statement (déclaration d'accessibilité) for an audit. This is used to generate the public accessibility statement.",
  {
    editUniqueId: z.string().describe("The editUniqueId of the audit"),
    initiator: z.string().optional().describe("Organisation requesting the audit"),
    auditorOrganisation: z.string().optional().describe("Auditing organisation"),
    procedureUrl: z.string().optional().describe("URL of the audited site"),
    contactName: z.string().optional().describe("Accessibility contact name"),
    contactEmail: z.string().optional().describe("Accessibility contact email"),
    contactFormUrl: z.string().optional().describe("Accessibility contact form URL"),
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

server.tool(
  "export_csv",
  "Export audit results in CSV format.",
  {
    uniqueId: z.string().describe("The editUniqueId of the audit"),
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

// ─── Auto-login on startup ───────────────────────────────

async function autoLogin() {
  const username = process.env.ARA_USERNAME;
  const password = process.env.ARA_PASSWORD;
  if (username && password && !process.env.ARA_AUTH_TOKEN) {
    try {
      const token = await client.signin(username, password);
      client.setAuthToken(token);
      console.error("[ara-mcp] Auto-authenticated as", username);
    } catch (err) {
      console.error("[ara-mcp] Auto-login failed:", err);
    }
  }
}

// ─── Start ────────────────────────────────────────────────

async function main() {
  await autoLogin();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ara-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[ara-mcp] Fatal error:", err);
  process.exit(1);
});
