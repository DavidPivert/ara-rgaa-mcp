/**
 * Ara API Client
 *
 * HTTP client for the Ara RGAA accessibility audit platform.
 * Handles all REST API communication with the Ara backend.
 */

export interface AraClientConfig {
  /** Base URL of the Ara API (e.g. https://ara.numerique.gouv.fr/api) */
  baseUrl: string;
  /** Optional Bearer token for authenticated endpoints */
  authToken?: string;
}

export class AraClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(config: AraClientConfig) {
    // Remove trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authToken = config.authToken;
  }

  private headers(
    extra: Record<string, string> = {},
    includeAuth = true
  ): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (includeAuth && this.authToken) {
      h["Authorization"] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { auth?: boolean } = {}
  ): Promise<T> {
    const { auth = true } = options;
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: this.headers({}, auth),
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Ara API error: ${res.status} ${res.statusText} — ${method} ${path}\n${text}`
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  // ─── Auth ───────────────────────────────────────────────

  /**
   * Sign in and return a JWT token.
   *
   * Sent WITHOUT the Authorization header: carrying a stale or expired token
   * on this route makes the Ara API answer `404 Cannot POST /api/auth/signin`
   * instead of a real result — which would break the very case sign-in exists
   * for, renewing an expired session.
   */
  async signin(username: string, password: string): Promise<string> {
    const payload = await this.request<unknown>(
      "POST",
      "/auth/signin",
      { username, password },
      { auth: false }
    );

    // The API has returned the raw token as a string; accept the common
    // object shapes too rather than silently storing an object as a token.
    const token =
      typeof payload === "string"
        ? payload
        : (payload as Record<string, unknown> | null)?.["accessToken"] ??
          (payload as Record<string, unknown> | null)?.["access_token"] ??
          (payload as Record<string, unknown> | null)?.["token"];

    if (typeof token !== "string" || token.length === 0) {
      throw new Error(
        "Unexpected sign-in response: no token found. The Ara API may have " +
          "changed its response shape."
      );
    }
    return token;
  }

  /** Set the auth token for subsequent requests */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /** Whether a token is currently held. Never exposes the token itself. */
  isAuthenticated(): boolean {
    return Boolean(this.authToken);
  }

  // ─── Audits — CRUD ─────────────────────────────────────

  /** Create a new audit */
  async createAudit(data: CreateAuditPayload): Promise<AuditResponse> {
    return this.request<AuditResponse>("POST", "/audits", data);
  }

  /** Get an audit by its edit unique ID */
  async getAudit(uniqueId: string): Promise<AuditResponse> {
    return this.request<AuditResponse>("GET", `/audits/${uniqueId}`);
  }

  /** Full update of an audit */
  async updateAudit(
    uniqueId: string,
    data: UpdateAuditPayload
  ): Promise<AuditResponse> {
    return this.request<AuditResponse>("PUT", `/audits/${uniqueId}`, data);
  }

  /** Partial update of an audit (currently: notes) */
  async patchAudit(
    uniqueId: string,
    data: PatchAuditPayload
  ): Promise<void> {
    return this.request<void>("PATCH", `/audits/${uniqueId}`, data);
  }

  /** Soft-delete an audit */
  async deleteAudit(uniqueId: string): Promise<void> {
    return this.request<void>("DELETE", `/audits/${uniqueId}`);
  }

  /** Duplicate an audit */
  async duplicateAudit(
    uniqueId: string,
    procedureName: string
  ): Promise<AuditResponse> {
    return this.request<AuditResponse>(
      "POST",
      `/audits/${uniqueId}/duplicate`,
      { procedureName }
    );
  }

  /** Publish a completed audit */
  async publishAudit(uniqueId: string): Promise<AuditResponse> {
    return this.request<AuditResponse>("PUT", `/audits/${uniqueId}/publish`);
  }

  // ─── Results (criteria) ─────────────────────────────────

  /** Get all criterion results for an audit */
  async getResults(uniqueId: string): Promise<CriterionResult[]> {
    return this.request<CriterionResult[]>(
      "GET",
      `/audits/${uniqueId}/results`
    );
  }

  /** Update criterion results for an audit (batch) */
  async updateResults(
    uniqueId: string,
    data: UpdateResultsItem[]
  ): Promise<void> {
    return this.request<void>("PATCH", `/audits/${uniqueId}/results`, {
      data,
    });
  }

  /** Get results for a specific page of an audit */
  async getPageResults(
    uniqueId: string,
    pageSlug: string
  ): Promise<PageWithResults> {
    return this.request<PageWithResults>(
      "GET",
      `/audits/${uniqueId}/pages/${pageSlug}`
    );
  }

  // ─── Reports (read-only, by consultUniqueId) ────────────

  /** Get the audit report (by consultation ID) */
  async getReport(consultUniqueId: string): Promise<AuditReport> {
    return this.request<AuditReport>("GET", `/reports/${consultUniqueId}`);
  }

  // ─── Statement ──────────────────────────────────────────

  /** Update the accessibility statement for an audit */
  async updateStatement(
    editUniqueId: string,
    data: UpdateStatementPayload
  ): Promise<AuditResponse> {
    return this.request<AuditResponse>(
      "PUT",
      `/audits/${editUniqueId}/statement`,
      data
    );
  }

  // ─── Export ─────────────────────────────────────────────

  /** Get CSV export of audit results */
  async getCsvExport(uniqueId: string): Promise<string> {
    return this.request<string>("GET", `/audits/${uniqueId}/exports/csv`);
  }
}

// ─── Type definitions ───────────────────────────────────

export type AuditType = "FULL" | "FAST" | "COMPLEMENTARY";

export type CriterionResultStatus =
  | "COMPLIANT"
  | "NOT_COMPLIANT"
  | "NOT_APPLICABLE"
  | "NOT_TESTED";

export type CriterionResultUserImpact = "MINOR" | "MAJOR" | "BLOCKING";

export interface CreateAuditPage {
  id?: number;
  name: string;
  url: string;
}

export interface PageElements {
  multimedia: boolean;
  form: boolean;
  table: boolean;
  frame: boolean;
}

export interface CreateAuditPayload {
  auditType: AuditType;
  procedureName: string;
  pages: CreateAuditPage[];
  auditorName: string;
  /** Required in practice: the API answers 500 when it is missing. */
  auditorEmail: string;
  pageElements: PageElements;
}

export interface AuditEnvironment {
  platform: string;
  operatingSystem: string;
  assistiveTechnology: string;
  browser: string;
}

export interface UpdateAuditPayload {
  auditType: AuditType;
  procedureName: string;
  pages: CreateAuditPage[];
  auditorName: string;
  auditorEmail: string;
  procedureUrl?: string;
  initiator?: string;
  auditorOrganisation?: string;
  contactName?: string;
  contactEmail?: string;
  contactFormUrl?: string;
  tools?: string[];
  environments?: AuditEnvironment[];
  technologies?: string[];
  notCompliantContent?: string;
  derogatedContent?: string;
  notInScopeContent?: string;
  notes?: string;
  transverseElements?: string[];
}

export interface PatchAuditPayload {
  notes?: string;
}

/**
 * One issue found for a criterion.
 *
 * Ara moved the description of a non-compliance out of the criterion and into
 * this list: the user impact and the quick-win flag belong to each issue, not
 * to the criterion as a whole. The report counts blocking issues by reading
 * `userImpact` here.
 */
export interface NotCompliantItem {
  title?: string;
  comment?: string;
  userImpact?: CriterionResultUserImpact;
  quickWin?: boolean;
}

export interface UpdateResultsItem {
  pageId: number;
  topic: number;
  criterium: number;
  status: CriterionResultStatus;
  compliantComment?: string;
  notApplicableComment?: string;
  /** Required by the API on every item; send [] when there is nothing to report. */
  notCompliantItems: NotCompliantItem[];
}

export interface UpdateStatementPayload {
  initiator?: string;
  auditorOrganisation?: string;
  procedureUrl?: string;
  contactName?: string;
  contactEmail?: string;
  contactFormUrl?: string;
  technologies?: string[];
  tools?: string[];
  environments?: AuditEnvironment[];
  notCompliantContent?: string;
  derogatedContent?: string;
  notInScopeContent?: string;
}

// ─── Response types ─────────────────────────────────────

export interface PageDto {
  id: number;
  order: number;
  name: string;
  url: string;
}

export interface AuditResponse {
  id: number;
  editUniqueId: string;
  consultUniqueId: string;
  auditType: AuditType;
  procedureName: string;
  transverseElementsPageId: number;
  auditorName: string | null;
  auditorEmail: string | null;
  initiator: string | null;
  transverseElements: string[];
  auditorOrganisation: string | null;
  procedureUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactFormUrl: string | null;
  technologies: string[];
  tools: string[];
  notCompliantContent: string | null;
  derogatedContent: string | null;
  notInScopeContent: string | null;
  notes: string | null;
  creationDate: string | null;
  publicationDate: string | null;
  editionDate: string | null;
  pages: PageDto[];
}

export interface CriterionResult {
  status: CriterionResultStatus;
  compliantComment: string | null;
  notCompliantComment: string | null;
  userImpact: CriterionResultUserImpact | null;
  quickWin: boolean;
  notApplicableComment: string | null;
  topic: number;
  criterium: number;
  pageId: number;
}

export interface PageWithResults {
  id: number;
  name: string;
  results: CriterionResult[];
}

export interface AuditReport {
  consultUniqueId: string;
  procedureName: string;
  procedureUrl?: string;
  accessibilityRate: number;
  criteriaCount: {
    total: number;
    compliant: number;
    notCompliant: number;
    blocking: number;
    applicable: number;
    notApplicable: number;
  };
  results: CriterionResult[];
}
