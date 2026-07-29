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
import {
  readCredentials,
  writeCredentials,
  clearCredentials,
  credentialsPath,
  ageEnHeures,
} from "./credentials.js";
import {
  RGAA_VERSION,
  RGAA_TOPICS,
  FAST_CRITERIA,
  COMPLEMENTARY_CRITERIA,
  GUIDE_BESOINS,
  type RgaaBesoin,
} from "./rgaa-data.js";

// ─── Configuration ────────────────────────────────────────

/** Keep in sync with the "version" field of package.json. */
const SERVER_VERSION = "2.4.0";

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

// ─── Rich-text safety ─────────────────────────────────────

/**
 * Ara stores criterion comments as rich text.
 *
 * An accessibility audit quotes markup constantly — "<th>", "<label for>",
 * "<video>" — and sent as-is those are parsed as tags and silently vanish from
 * the stored comment. The API answers 200, the auditor's finding loses its
 * substance, and nothing reports it.
 *
 * Escaping the angle brackets makes quoted code survive. `&` is deliberately
 * left alone so that a caller who already escaped ("&lt;th&gt;") is not
 * double-escaped.
 */
function escapeRichText(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Same, but leaves undefined untouched. */
function escapeOptional(value?: string): string | undefined {
  return value === undefined ? undefined : escapeRichText(value);
}

// ─── RGAA reference ───────────────────────────────────────

/** Besoins de vérification d'un critère, ou null s'il n'existe pas. */
function besoinsDe(id: string): RgaaBesoin[] | null {
  const [t, c] = id.split(".").map(Number);
  const crit = RGAA_TOPICS.find((x) => x.number === t)?.criteria.find(
    (x) => x.number === c
  );
  return crit ? crit.besoins : null;
}

/** Bloc de vérification joint à un critère. */
function verificationDe(besoins: RgaaBesoin[]) {
  return {
    sourceSuffit: besoins.length === 0,
    besoins,
    commentVerifier: besoins.map((b) => `${b} — ${GUIDE_BESOINS[b]}`),
    avertissement:
      "Classification propre à ce serveur, déduite du vocabulaire des tests puis corrigée à la main. Le RGAA dit quoi vérifier, pas avec quel outil.",
  };
}

/** Criteria covered by an Ara audit type, as "topic.criterium" ids. */
function criteriaIdsFor(auditType: "FULL" | "FAST" | "COMPLEMENTARY"): string[] | null {
  if (auditType === "FAST") return FAST_CRITERIA;
  if (auditType === "COMPLEMENTARY") return COMPLEMENTARY_CRITERIA;
  return null; // FULL: every criterion
}

// ─── Tools ────────────────────────────────────────────────

/** Declare every tool on a server instance. Called once per instance built. */
function registerAllTools(server: McpServer): void {

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: list_rgaa_criteria
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "list_rgaa_criteria",
  {
    title: "List the RGAA criteria",
    description: `List RGAA ${RGAA_VERSION} criteria as an index: topic number, topic name, criterion number and wording. Tests are NOT included — call get_rgaa_criterion for those.

Use this to know what an audit actually covers before evaluating anything. Filter to keep the answer small:
- auditType FAST — the 25 criteria of a rapid audit
- auditType COMPLEMENTARY — the 25 complementary criteria (disjoint from the rapid ones)
- auditType FULL, or no filter — all 106
- topic — restrict to one of the 13 topics

Source: the RGAA reference shipped with Ara, published by the DINUM under Licence Ouverte 2.0.`,
    inputSchema: z.object({
      auditType: z
        .enum(["FULL", "FAST", "COMPLEMENTARY"])
        .optional()
        .describe("Keep only the criteria covered by this Ara audit type"),
      topic: z
        .number()
        .min(1)
        .max(13)
        .optional()
        .describe("Keep only this RGAA topic (1-13)"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ auditType, topic }) => {
    try {
      const keep = auditType ? criteriaIdsFor(auditType) : null;
      const topics = RGAA_TOPICS.filter((t) => !topic || t.number === topic).map(
        (t) => ({
          topic: t.number,
          name: t.name,
          criteria: t.criteria
            .filter((c) => !keep || keep.includes(`${t.number}.${c.number}`))
            .map((c) => ({
              id: `${t.number}.${c.number}`,
              title: c.title,
            })),
        })
      );
      const kept = topics.filter((t) => t.criteria.length > 0);
      return textResult({
        rgaaVersion: RGAA_VERSION,
        filter: { auditType: auditType ?? "none", topic: topic ?? "none" },
        criteriaCount: kept.reduce((a, t) => a + t.criteria.length, 0),
        topics: kept,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: get_audit_method
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "get_audit_method",
  {
    title: "Plan de travail d'un audit",
    description: `Return the work plan for an audit type: which criteria can be settled by reading the HTML source, and which ones require the rendered page, keyboard navigation, the accessibility tree, or editorial judgement.

Call this BEFORE starting an audit. It tells you which tools you will actually need — a browser, a keyboard pass, a screen reader — instead of discovering halfway through that half the criteria cannot be answered from markup.

Criteria that need more than the source cannot be marked COMPLIANT or NOT_COMPLIANT by update_audit_results without declaring the matching evidence.

This classification is guidance from this server, not a prescription of the RGAA.`,
    inputSchema: z.object({
      auditType: z
        .enum(["FULL", "FAST", "COMPLEMENTARY"])
        .describe("The Ara audit type you are about to run"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ auditType }) => {
    try {
      const keep = criteriaIdsFor(auditType);
      const crits = RGAA_TOPICS.flatMap((t) =>
        t.criteria
          .filter((c) => !keep || keep.includes(`${t.number}.${c.number}`))
          .map((c) => ({ id: `${t.number}.${c.number}`, titre: c.title, besoins: c.besoins }))
      );
      const parBesoin: Record<string, string[]> = {};
      for (const c of crits)
        for (const b of c.besoins) (parBesoin[b] ??= []).push(c.id);
      const sourceSeul = crits.filter((c) => !c.besoins.length).map((c) => c.id);
      return textResult({
        rgaaVersion: RGAA_VERSION,
        auditType,
        criteres: crits.length,
        sourceSuffit: { nombre: sourceSeul.length, criteres: sourceSeul },
        exigentDavantage: Object.fromEntries(
          Object.entries(parBesoin).map(([b, ids]) => [
            b,
            { nombre: ids.length, criteres: ids, commentFaire: GUIDE_BESOINS[b as RgaaBesoin] },
          ])
        ),
        avertissement:
          "Classification propre à ce serveur, déduite du vocabulaire des tests puis corrigée à la main. Le RGAA dit quoi vérifier, pas avec quel outil.",
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOOL: get_rgaa_criterion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool(
  "get_rgaa_criterion",
  {
    title: "Get one RGAA criterion and its tests",
    description: `Return the wording of a single RGAA ${RGAA_VERSION} criterion AND its numbered tests — the checks an auditor actually performs to decide COMPLIANT / NOT_COMPLIANT / NOT_APPLICABLE.

Call this before evaluating a criterion with update_audit_results: it is what turns "topic 6, criterium 1" into something you can actually assess. Also tells whether the criterion belongs to the rapid or complementary audit.

The "verification" block says what is needed BEYOND the HTML source to settle the criterion — keyboard navigation, rendered page, accessibility tree, or editorial judgement — and how to go about it. When "sourceSuffit" is false, reading the markup is not enough: open the page.

Source: the RGAA reference shipped with Ara, published by the DINUM under Licence Ouverte 2.0.`,
    inputSchema: z.object({
      topic: z.number().min(1).max(13).describe("RGAA topic number (1-13)"),
      criterium: z.number().min(1).describe("Criterion number within the topic"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ topic, criterium }) => {
    try {
      const t = RGAA_TOPICS.find((x) => x.number === topic);
      const c = t?.criteria.find((x) => x.number === criterium);
      if (!t || !c) {
        const available = (t?.criteria ?? []).map((x) => `${topic}.${x.number}`);
        throw new Error(
          `No RGAA criterion ${topic}.${criterium}.` +
            (t
              ? ` Topic ${topic} (${t.name}) has: ${available.join(", ")}.`
              : ` Topics run from 1 to 13.`)
        );
      }
      const id = `${topic}.${criterium}`;
      return textResult({
        rgaaVersion: RGAA_VERSION,
        id,
        topic: { number: t.number, name: t.name },
        title: c.title,
        inFastAudit: FAST_CRITERIA.includes(id),
        inComplementaryAudit: COMPLEMENTARY_CRITERIA.includes(id),
        verification: verificationDe(c.besoins),
        tests: c.tests,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

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
      const stocke = readCredentials();
      if (stocke && stocke.baseUrl === ARA_BASE_URL && !process.env.ARA_AUTH_TOKEN) {
        client.setAuthToken(stocke.token);
        const frais = await client.refreshToken();
        client.setAuthToken(frais);
        writeCredentials({ ...stocke, token: frais, obtenuLe: new Date().toISOString() });
        return textResult({
          authenticated: true,
          message: `Session rafraîchie depuis le jeton enregistré${stocke.username ? ` (${stocke.username})` : ""}.`,
        });
      }
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
- FAST: 25 criteria (audit rapide)
- COMPLEMENTARY: 25 criteria (audit complémentaire) — disjoint from the rapid ones, the two methodologies together covering 50

Call list_rgaa_criteria to see exactly which criteria a type covers.`,
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
          auditorEmail: z
        .string()
        .describe(
          "Email of the auditor. Required: the Ara API answers 500 Internal Server Error when it is missing, even though it does not list the field as mandatory."
        ),
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
          auditorEmail: z.string(),
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
      "Update only the notes field of an audit, without touching other metadata. The new content REPLACES the existing notes.\n\nUnlike criterion comments, this field is passed through as rich text: HTML is interpreted. Write &lt;th&gt; rather than <th> if you need to quote markup literally.",
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
      "Soft-delete an audit. The audit itself returns HTTP 410 Gone for future requests, and disappears from the account's audit list. This cannot be undone from this server.\n\nIMPORTANT — deleting does NOT unpublish. If the audit was published, its report REMAINS publicly readable at its consultation URL after deletion, and it is then reachable from nowhere in the Ara interface, so it can no longer be edited or withdrawn. Verified against the live API. Do not present deletion to the user as a way to undo a publication.",
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
      "Mark an audit as published/completed. This makes the audit report and its accessibility statement PUBLICLY available at their consultation URL — confirm with the user before calling it. The audit must be fully filled in (all criteria evaluated) before publishing. Returns HTTP 409 if incomplete.\n\nIMPORTANT — publishing is effectively irreversible from here. There is no unpublish operation, and delete_audit does NOT withdraw a published report: it stays publicly readable while disappearing from the Ara interface. Make sure the user means to publish THIS audit, on THIS site, before calling it — publishing an audit about a third party puts a public accessibility statement about them under the auditor's name.",
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
- compliantComment / notApplicableComment
- notCompliantItems: the individual issues found, each with title, comment, userImpact (MINOR | MAJOR | BLOCKING) and quickWin`,
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

Before evaluating a criterion, call get_rgaa_criterion to read its wording and its tests: it is what lets you judge rather than guess.

Comments are stored as rich text by Ara, so this server escapes < and > before sending: quote markup freely (<th>, <label for>, <video>) and it will survive as written. Do not pre-escape.

Describing a non-compliance: the details live in notCompliantItems, one entry per issue found, each with its own title, comment, userImpact (MINOR | MAJOR | BLOCKING) and quickWin. The API requires this array on EVERY item — send [] when there is nothing to report. Ara counts an audit as having blocking issues by looking at the userImpact of these entries, not of the criterion.`,
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
                notApplicableComment: z
                  .string()
                  .optional()
                  .describe("Comment when criterion is not applicable"),
                evidence: z
                  .array(z.enum(["clavier", "rendu", "restitution", "humain"]))
                  .optional()
                  .describe(
                    "What you actually did beyond reading the HTML source. Required when the criterion demands it — call get_rgaa_criterion or get_audit_method to know. Declare only what you truly performed."
                  ),
                notCompliantItems: z
                  .array(
                    z.object({
                      title: z
                        .string()
                        .optional()
                        .describe("Short title of the issue"),
                      comment: z
                        .string()
                        .optional()
                        .describe("Description of the issue"),
                      userImpact: z
                        .enum(["MINOR", "MAJOR", "BLOCKING"])
                        .optional()
                        .describe("How much this issue impacts users"),
                      quickWin: z
                        .boolean()
                        .optional()
                        .describe("Whether this issue is easy to fix"),
                    })
                  )
                  .default([])
                  .describe(
                    "The individual issues found for this criterion. Required by the API on EVERY item — send [] when the criterion is compliant, not applicable or not tested."
                  ),
              })
            )
            .describe("Array of criterion results to update"),
        }),
    annotations: DESTRUCTIVE,
  },
  async ({ uniqueId, results }) => {
    try {
      // Un verdict CONFORME ou NON CONFORME sur un critère qui ne se tranche
      // pas depuis le source doit s'appuyer sur une vérification déclarée.
      // NOT_TESTED et NOT_APPLICABLE en sont dispensés : ils n'affirment rien.
      const manquants = results
        .filter((r) => r.status === "COMPLIANT" || r.status === "NOT_COMPLIANT")
        .map((r) => {
          const id = `${r.topic}.${r.criterium}`;
          const requis = besoinsDe(id) ?? [];
          const fournis = r.evidence ?? [];
          return { id, absents: requis.filter((b) => !fournis.includes(b)) };
        })
        .filter((x) => x.absents.length > 0);

      if (manquants.length > 0) {
        const detail = manquants
          .map(
            (m) =>
              `  ${m.id} — exige : ${m.absents
                .map((b) => `${b} (${GUIDE_BESOINS[b]})`)
                .join(" ; ")}`
          )
          .join("\n");
        throw new Error(
          `Verdict refusé sur ${manquants.length} critère(s) : le code source ne suffit pas à les trancher, ` +
            `et la vérification correspondante n'a pas été déclarée.\n\n${detail}\n\n` +
            `Effectuez réellement ces vérifications, puis renseignez le champ "evidence" du résultat concerné. ` +
            `Si vous ne pouvez pas les faire, utilisez le statut NOT_TESTED plutôt qu'un verdict non fondé.`
        );
      }

      // Les commentaires sont stockés en texte riche : voir escapeRichText.
      const safe = results.map(({ evidence: _evidence, ...r }) => ({
        ...r,
        compliantComment: escapeOptional(r.compliantComment),
        notApplicableComment: escapeOptional(r.notApplicableComment),
        notCompliantItems: (r.notCompliantItems ?? []).map((i) => ({
          ...i,
          title: escapeOptional(i.title),
          comment: escapeOptional(i.comment),
        })),
      }));
      await client.updateResults(uniqueId, safe);
      return textResult({
        message: `Successfully updated ${results.length} criterion result(s)`,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// NOTE: there is no get_page_results tool.
//
// `GET /audits/:uniqueId/pages/:pageSlug` exists, but it matches on the page's
// `slug` column — a per-audit unique value that no API response ever returns.
// Neither the page order nor the page id resolves it, so a caller has no way
// to obtain one. Use get_audit_results and filter on pageId instead: it
// returns every page's results, and get_audit maps pageId to a page name.

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
      "Update the accessibility statement (déclaration d'accessibilité) for an audit, REPLACING the current statement fields. This also PUBLISHES the statement: after the call the audit carries a statementPublicationDate and the déclaration is available at its public consultation URL — confirm with the user before calling it. Publishing the statement is separate from publish_audit, which publishes the audit report.",
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

// ─── Authentification au démarrage ───────────────────────

/**
 * Résout l'authentification, par ordre de priorité :
 *   1. ARA_AUTH_TOKEN — jeton fourni tel quel (24 h, pour l'automatisation) ;
 *   2. le fichier écrit par `login` — rafraîchi puis réécrit ;
 *   3. ARA_USERNAME / ARA_PASSWORD — connexion au démarrage ;
 *   4. rien — le serveur démarre quand même, et chaque appel expliquera quoi faire.
 */
async function resoudreAuthentification(): Promise<void> {
  if (process.env.ARA_AUTH_TOKEN) {
    client.setAuthToken(process.env.ARA_AUTH_TOKEN);
    console.error("[ara-mcp] Jeton fourni par ARA_AUTH_TOKEN (valable 24 h).");
    return;
  }

  const stocke = readCredentials();
  if (stocke) {
    if (stocke.baseUrl !== ARA_BASE_URL) {
      console.error(
        `[ara-mcp] Le jeton enregistré vise ${stocke.baseUrl}, or ARA_BASE_URL vaut ${ARA_BASE_URL}. Jeton ignoré.`
      );
    } else {
      client.setAuthToken(stocke.token);
      try {
        const frais = await client.refreshToken();
        client.setAuthToken(frais);
        writeCredentials({ ...stocke, token: frais, obtenuLe: new Date().toISOString() });
        console.error(
          `[ara-mcp] Session rafraîchie${stocke.username ? ` (${stocke.username})` : ""}.`
        );
      } catch {
        const age = Math.round(ageEnHeures(stocke));
        console.error(
          `[ara-mcp] Le jeton enregistré n'est plus valide (obtenu il y a ~${age} h ; ils durent 24 h).\n` +
            `[ara-mcp] Relancez : npx ara-rgaa-mcp login`
        );
      }
      return;
    }
  }

  if (process.env.ARA_USERNAME && process.env.ARA_PASSWORD) {
    try {
      const token = await client.signin(
        process.env.ARA_USERNAME,
        process.env.ARA_PASSWORD
      );
      client.setAuthToken(token);
      console.error("[ara-mcp] Authentifié depuis ARA_USERNAME / ARA_PASSWORD.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ara-mcp] Échec de l'authentification :", message);
    }
    return;
  }

  console.error(
    "[ara-mcp] Aucune authentification configurée.\n" +
      "[ara-mcp] Le plus simple : npx ara-rgaa-mcp login\n" +
      "[ara-mcp] Sinon, renseignez ARA_AUTH_TOKEN, ou ARA_USERNAME et ARA_PASSWORD."
  );
}

// ─── Start ────────────────────────────────────────────────

/** Sous-commandes de la ligne de commande, avant tout démarrage MCP. */
async function traiterSousCommande(): Promise<number | null> {
  const cmd = process.argv[2];
  if (!cmd || cmd.startsWith("-")) return null;

  if (cmd === "login") {
    const { runLogin } = await import("./login.js");
    return runLogin(ARA_BASE_URL);
  }

  if (cmd === "logout") {
    const efface = clearCredentials();
    console.error(
      efface
        ? `Jeton supprimé (${credentialsPath()}).`
        : "Aucun jeton enregistré."
    );
    return 0;
  }

  if (cmd === "status") {
    const s = readCredentials();
    if (!s) {
      console.error("Aucun jeton enregistré. Lancez : npx ara-rgaa-mcp login");
      return 1;
    }
    const age = ageEnHeures(s);
    console.error(`Compte    : ${s.username ?? "(inconnu)"}`);
    console.error(`Instance  : ${s.baseUrl}`);
    console.error(`Fichier   : ${credentialsPath()}`);
    console.error(
      `Jeton     : obtenu il y a ~${Math.round(age)} h — ${age < 24 ? "encore valide, rafraîchi au prochain démarrage" : "expiré, relancez login"}`
    );
    return age < 24 ? 0 : 1;
  }

  console.error(
    `Commande inconnue : ${cmd}\n\n` +
      `Usage :\n` +
      `  npx ara-rgaa-mcp          démarre le serveur MCP (usage normal)\n` +
      `  npx ara-rgaa-mcp login    se connecter à Ara et enregistrer le jeton\n` +
      `  npx ara-rgaa-mcp status    état du jeton enregistré\n` +
      `  npx ara-rgaa-mcp logout    supprimer le jeton enregistré`
  );
  return 2;
}

async function main() {
  const code = await traiterSousCommande();
  if (code !== null) {
    process.exit(code);
  }

  await resoudreAuthentification();
  // Negotiates the protocol revision when the connection opens, and serves
  // both the 2025 era and 2026-07-28 from the same factory.
  serveStdio(() => buildServer());
  console.error("[ara-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[ara-mcp] Fatal error:", err);
  process.exit(1);
});
