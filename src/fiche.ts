/**
 * Recopie de la fiche d'un audit dans sa copie.
 *
 * Constaté le 01/10/2026 : `POST /audits/:id/duplicate` copie les pages, les
 * environnements et les résultats, mais laisse vides initiator,
 * auditorOrganisation, procedureUrl, contactName, contactEmail,
 * contactFormUrl, technologies et tools. Et `PUT /audits/:id` renumérote les
 * pages dans l'ordre du tableau reçu : il faut les renvoyer dans l'ordre de la
 * source, sous peine de voir l'échantillon réordonné dans le rapport.
 */
import type { AuditResponse, UpdateAuditPayload, AuditEnvironment } from "./ara-client.js";

const REPRIS = [
  "initiator",
  "auditorOrganisation",
  "procedureUrl",
  "contactName",
  "contactEmail",
  "contactFormUrl",
] as const;
const LISTES = ["technologies", "tools", "transverseElements"] as const;
const TEXTES = ["notCompliantContent", "derogatedContent", "notInScopeContent", "notes"] as const;

const vide = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const cle = (p: { name: string; url: string }) => `${p.name}\u0000${p.url}`;

export interface FicheDeCopie {
  payload: UpdateAuditPayload;
  /** Champs vides dans la copie et repris de la source. */
  repris: string[];
}

/**
 * Charge utile d'update_audit pour la copie : ses propres valeurs quand elles
 * existent, celles de la source sinon ; ses pages (ses identifiants) dans
 * l'ordre de la source. Lève une erreur si les pages ne s'apparient pas.
 */
export function ficheDeCopie(source: AuditResponse, copie: AuditResponse, procedureName?: string): FicheDeCopie {
  const parCle = new Map(copie.pages.map((p) => [cle(p), p]));
  const ordreSource = [...source.pages].sort((a, b) => a.order - b.order);
  if (parCle.size !== copie.pages.length || ordreSource.some((p) => !parCle.has(cle(p))) || ordreSource.length !== copie.pages.length) {
    throw new Error(
      "Les pages de la copie ne correspondent pas à celles de la source (nom et URL) : fiche non recopiée."
    );
  }
  const repris: string[] = [];
  const valeur = <K extends keyof AuditResponse>(k: K) => {
    if (!vide(copie[k])) return copie[k];
    if (!vide(source[k])) repris.push(k);
    return source[k];
  };

  const envs = ((vide(copie.environments) ? source.environments : copie.environments) ?? []) as AuditEnvironment[];
  const payload: UpdateAuditPayload = {
    auditType: copie.auditType,
    procedureName: procedureName ?? copie.procedureName,
    pages: ordreSource.map((p) => {
      const c = parCle.get(cle(p))!;
      return { id: c.id, name: c.name, url: c.url };
    }),
    auditorName: (valeur("auditorName") as string | null) ?? "",
    auditorEmail: (valeur("auditorEmail") as string | null) ?? "",
    environments: envs.map(({ platform, operatingSystem, assistiveTechnology, browser }) => ({
      platform,
      operatingSystem,
      assistiveTechnology,
      browser,
    })),
  };
  for (const k of REPRIS) {
    const v = valeur(k) as string | null;
    if (!vide(v)) payload[k] = v as string;
  }
  for (const k of LISTES) {
    const v = valeur(k) as string[];
    if (!vide(v)) payload[k] = v;
  }
  for (const k of TEXTES) {
    const v = valeur(k) as string | null;
    if (!vide(v)) payload[k] = v as string;
  }
  return { payload, repris };
}
