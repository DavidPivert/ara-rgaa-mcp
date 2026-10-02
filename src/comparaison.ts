/**
 * Comparaison de deux audits : avant et après correctifs (audit initial et sa
 * copie de retest, ou deux campagnes successives sur le même échantillon).
 *
 * Les pages s'apparient par nom et URL (les identifiants diffèrent d'une copie
 * à l'autre), la page des éléments transverses avec son homologue.
 *
 * Statut d'un critère sur l'audit, règle de calcul d'Ara :
 *  - non conforme s'il est non conforme sur au moins une page ;
 *  - conforme s'il est conforme sur au moins une page et non conforme sur aucune ;
 *  - non applicable s'il l'est sur toutes les pages ;
 *  - non testé s'il reste non testé quelque part sans être non conforme ailleurs.
 * Taux = conformes / (conformes + non conformes), arrondi comme l'affiche Ara.
 */
import type { AuditResponse, CriterionResult } from "./ara-client.js";

type Statut = CriterionResult["status"];
const COURT: Record<Statut, string> = {
  COMPLIANT: "C",
  NOT_COMPLIANT: "NC",
  NOT_APPLICABLE: "NA",
  NOT_TESTED: "NT",
};

export interface SyntheseAudit {
  procedureName: string;
  taux: number | null;
  tauxExact: number | null;
  criteres: { conformes: number; nonConformes: number; nonApplicables: number; nonTestes: number };
  resultats: Record<string, number>;
}

function statutCritere(statuts: Statut[]): Statut {
  if (statuts.includes("NOT_COMPLIANT")) return "NOT_COMPLIANT";
  if (statuts.includes("NOT_TESTED")) return "NOT_TESTED";
  if (statuts.includes("COMPLIANT")) return "COMPLIANT";
  return "NOT_APPLICABLE";
}

export function synthese(audit: AuditResponse, results: CriterionResult[]): SyntheseAudit & { parCritere: Map<string, Statut> } {
  const parId = new Map<string, Statut[]>();
  const resultats: Record<string, number> = {};
  for (const r of results) {
    const id = `${r.topic}.${r.criterium}`;
    (parId.get(id) ?? parId.set(id, []).get(id)!).push(r.status);
    resultats[COURT[r.status]] = (resultats[COURT[r.status]] ?? 0) + 1;
  }
  const parCritere = new Map<string, Statut>();
  const c = { conformes: 0, nonConformes: 0, nonApplicables: 0, nonTestes: 0 };
  for (const [id, statuts] of parId) {
    const s = statutCritere(statuts);
    parCritere.set(id, s);
    if (s === "COMPLIANT") c.conformes++;
    else if (s === "NOT_COMPLIANT") c.nonConformes++;
    else if (s === "NOT_APPLICABLE") c.nonApplicables++;
    else c.nonTestes++;
  }
  const applicables = c.conformes + c.nonConformes;
  const complet = c.nonTestes === 0 && applicables > 0;
  const exact = complet ? (100 * c.conformes) / applicables : null;
  return {
    procedureName: audit.procedureName,
    taux: exact === null ? null : Math.round(exact),
    tauxExact: exact === null ? null : Math.round(exact * 100) / 100,
    criteres: c,
    resultats,
    parCritere,
  };
}

const cle = (p: { name: string; url: string }) => `${p.name}\u0000${p.url}`;

export interface Comparaison {
  avant: SyntheseAudit;
  apres: SyntheseAudit;
  pages: { avant: string; apres: string }[];
  pagesSansCorrespondance: { avant: string[]; apres: string[] };
  criteresChanges: { critere: string; avant: string; apres: string }[];
  resultatsChanges: {
    total: number;
    parTransition: Record<string, number>;
    liste: { critere: string; page: string; avant: string; apres: string }[];
    tronque: boolean;
  };
}

export function comparer(
  auditAvant: AuditResponse,
  resultatsAvant: CriterionResult[],
  auditApres: AuditResponse,
  resultatsApres: CriterionResult[],
  limite = 200
): Comparaison {
  // Correspondance des pages : transverse ↔ transverse, puis nom + URL.
  const nomApres = new Map<number, string>();
  const corresp = new Map<number, number>(); // pageId avant → pageId après
  const pages: { avant: string; apres: string }[] = [];
  if (auditAvant.transverseElementsPage && auditApres.transverseElementsPage) {
    corresp.set(auditAvant.transverseElementsPage.id, auditApres.transverseElementsPage.id);
    nomApres.set(auditApres.transverseElementsPage.id, "T");
    pages.push({ avant: "T", apres: "T" });
  }
  const apresParCle = new Map(auditApres.pages.map((p) => [cle(p), p]));
  const vus = new Set<number>();
  const sansAvant: string[] = [];
  for (const p of [...auditAvant.pages].sort((a, b) => a.order - b.order)) {
    const q = apresParCle.get(cle(p));
    if (!q) {
      sansAvant.push(p.name);
      continue;
    }
    corresp.set(p.id, q.id);
    nomApres.set(q.id, q.name);
    vus.add(q.id);
    pages.push({ avant: p.name, apres: q.name });
  }
  const sansApres = auditApres.pages.filter((q) => !vus.has(q.id)).map((q) => q.name);

  const apresParResultat = new Map(resultatsApres.map((r) => [`${r.pageId}|${r.topic}.${r.criterium}`, r.status]));
  const parTransition: Record<string, number> = {};
  const liste: Comparaison["resultatsChanges"]["liste"] = [];
  let total = 0;
  for (const r of resultatsAvant) {
    const idApres = corresp.get(r.pageId);
    if (idApres === undefined) continue;
    const s = apresParResultat.get(`${idApres}|${r.topic}.${r.criterium}`);
    if (!s || s === r.status) continue;
    total++;
    const t = `${COURT[r.status]}→${COURT[s]}`;
    parTransition[t] = (parTransition[t] ?? 0) + 1;
    if (liste.length < limite)
      liste.push({ critere: `${r.topic}.${r.criterium}`, page: nomApres.get(idApres) ?? String(idApres), avant: COURT[r.status], apres: COURT[s] });
  }

  const sAvant = synthese(auditAvant, resultatsAvant);
  const sApres = synthese(auditApres, resultatsApres);
  const tri = (a: string, b: string) => {
    const [x1, y1] = a.split(".").map(Number);
    const [x2, y2] = b.split(".").map(Number);
    return x1 - x2 || y1 - y2;
  };
  const criteresChanges = [...new Set([...sAvant.parCritere.keys(), ...sApres.parCritere.keys()])]
    .sort(tri)
    .filter((id) => sAvant.parCritere.get(id) !== sApres.parCritere.get(id))
    .map((id) => ({
      critere: id,
      avant: sAvant.parCritere.has(id) ? COURT[sAvant.parCritere.get(id)!] : "—",
      apres: sApres.parCritere.has(id) ? COURT[sApres.parCritere.get(id)!] : "—",
    }));

  const { parCritere: _a, ...avant } = sAvant;
  const { parCritere: _b, ...apres } = sApres;
  return {
    avant,
    apres,
    pages,
    pagesSansCorrespondance: { avant: sansAvant, apres: sansApres },
    criteresChanges,
    resultatsChanges: { total, parTransition, liste, tronque: total > liste.length },
  };
}
