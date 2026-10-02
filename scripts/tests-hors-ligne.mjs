// Tests hors ligne (aucun appel à Ara) des modules d'envoi, de fiche et de comparaison.
// Usage : npm run build && npm test
import assert from "node:assert/strict";
import { envoyerParPaquets, erreurServeur } from "../build/envois.js";
import { ficheDeCopie } from "../build/fiche.js";
import { comparer, synthese } from "../build/comparaison.js";

let n = 0;
const test = async (nom, f) => { await f(); n++; console.log("ok -", nom); };

// ─── Envois par paquets ───────────────────────────────────
const items = Array.from({ length: 45 }, (_, i) => ({ topic: i < 30 ? 10 : 12, criterium: (i % 14) + 1, pageId: i }));

await test("paquets de 20 sans erreur", async () => {
  const appels = [];
  const b = await envoyerParPaquets(items, async (p) => { appels.push(p.length); }, 20);
  assert.deepEqual(appels, [20, 20, 5]);
  assert.equal(b.envoyes, 45);
  assert.equal(b.echecs.length, 0);
});

await test("un paquet trop gros (500) est scindé jusqu'à passer", async () => {
  const b = await envoyerParPaquets(items, async (p) => {
    if (p.length > 6) throw new Error("Ara API error: 500 Internal Server Error — PATCH /audits/x/results");
  }, 20);
  assert.equal(b.envoyes, 45);
  assert.ok(b.scissions > 0);
  assert.equal(b.echecs.length, 0);
});

await test("un résultat refusé seul est rapporté, les autres passent", async () => {
  const b = await envoyerParPaquets(items, async (p) => {
    if (p.some((x) => x.pageId === 7)) throw new Error("Ara API error: 500 Internal Server Error");
  }, 20);
  assert.equal(b.envoyes, 44);
  assert.deepEqual(b.echecs.map((e) => e.item.pageId), [7]);
});

await test("une erreur 4xx arrête tout et dit ce qui est déjà passé", async () => {
  let i = 0;
  await assert.rejects(
    envoyerParPaquets(items, async () => { if (++i === 2) throw new Error("Ara API error: 400 Bad Request"); }, 20),
    /20 résultat\(s\) sur 45 déjà enregistré/
  );
});

await test("classement des erreurs", async () => {
  assert.equal(erreurServeur(new Error("Ara API error: 502 Bad Gateway")), true);
  assert.equal(erreurServeur(new Error("Ara API error: 409 Conflict")), false);
  assert.equal(erreurServeur(new Error("fetch failed")), true);
});

// ─── Fiche de la copie ────────────────────────────────────
const page = (id, order, name) => ({ id, order, name, url: `https://exemple.fr/${name}` });
const source = {
  auditType: "FULL", procedureName: "Site", auditorName: "A", auditorEmail: "a@exemple.fr",
  initiator: "Client", auditorOrganisation: "Agence", procedureUrl: "https://exemple.fr", contactName: "C",
  contactEmail: "c@exemple.fr", contactFormUrl: "https://exemple.fr/contact", technologies: ["HTML5"], tools: ["Ara"],
  transverseElements: ["En-tête"], notCompliantContent: null, derogatedContent: null, notInScopeContent: null, notes: "<p>n</p>",
  environments: [{ id: 1, platform: "Ordinateur", operatingSystem: "MacOS", assistiveTechnology: "VoiceOver", browser: "Safari" }],
  pages: [page(10, 0, "accueil"), page(11, 2, "zeta"), page(12, 1, "contact")],
};
const copie = {
  ...source, procedureName: "Site — retest", initiator: null, auditorOrganisation: null, procedureUrl: null, contactName: null,
  contactEmail: null, contactFormUrl: null, technologies: [], tools: [], notes: null,
  environments: [{ id: 9, platform: "Ordinateur", operatingSystem: "MacOS", assistiveTechnology: "VoiceOver", browser: "Safari" }],
  // ordre déjà perturbé : la fiche doit revenir à celui de la source
  pages: [page(20, 0, "accueil"), page(21, 1, "zeta"), page(22, 2, "contact")],
};

await test("la fiche reprend les champs vides et l'ordre de la source", async () => {
  const { payload, repris } = ficheDeCopie(source, copie);
  assert.deepEqual(payload.pages.map((p) => p.id), [20, 22, 21]);
  assert.equal(payload.procedureName, "Site — retest");
  assert.equal(payload.initiator, "Client");
  assert.deepEqual(payload.tools, ["Ara"]);
  assert.equal(payload.notes, "<p>n</p>");
  assert.deepEqual(payload.environments, [{ platform: "Ordinateur", operatingSystem: "MacOS", assistiveTechnology: "VoiceOver", browser: "Safari" }]);
  assert.ok(repris.includes("contactEmail") && !repris.includes("procedureName"));
  assert.ok(!("editUniqueId" in payload) && !("consultUniqueId" in payload));
});

await test("les valeurs propres de la copie sont gardées", async () => {
  const { payload } = ficheDeCopie(source, { ...copie, notes: "<p>retest</p>", tools: ["Ara", "axe"] });
  assert.equal(payload.notes, "<p>retest</p>");
  assert.deepEqual(payload.tools, ["Ara", "axe"]);
});

await test("pages qui ne s'apparient pas : refus", async () => {
  assert.throws(() => ficheDeCopie(source, { ...copie, pages: [page(20, 0, "accueil"), page(21, 1, "autre"), page(22, 2, "contact")] }), /ne correspondent pas/);
});

// ─── Comparaison ──────────────────────────────────────────
const r = (pageId, topic, criterium, status) => ({ pageId, topic, criterium, status });
const T1 = { ...source, transverseElementsPage: { id: 1, order: -1, name: "Éléments transverses", url: "" } };
const T2 = { ...copie, transverseElementsPage: { id: 2, order: -1, name: "Éléments transverses", url: "" } };
const avant = [r(1, 1, 1, "NOT_COMPLIANT"), r(10, 1, 1, "COMPLIANT"), r(1, 1, 2, "COMPLIANT"), r(10, 1, 2, "NOT_APPLICABLE"), r(1, 4, 1, "NOT_APPLICABLE"), r(10, 4, 1, "NOT_APPLICABLE")];
const apres = [r(2, 1, 1, "COMPLIANT"), r(20, 1, 1, "COMPLIANT"), r(2, 1, 2, "COMPLIANT"), r(20, 1, 2, "NOT_COMPLIANT"), r(2, 4, 1, "NOT_APPLICABLE"), r(20, 4, 1, "NOT_APPLICABLE")];

await test("statuts de critère et taux selon la règle d'Ara", async () => {
  const s = synthese(T1, avant);
  assert.deepEqual(s.criteres, { conformes: 1, nonConformes: 1, nonApplicables: 1, nonTestes: 0 });
  assert.equal(s.taux, 50);
  assert.equal(synthese(T1, [r(1, 1, 1, "NOT_TESTED")]).taux, null);
});

await test("comparaison : appariement des pages et transitions", async () => {
  const c = comparer(T1, avant, T2, apres);
  assert.deepEqual(c.pages, [{ avant: "T", apres: "T" }, { avant: "accueil", apres: "accueil" }, { avant: "contact", apres: "contact" }, { avant: "zeta", apres: "zeta" }]);
  assert.deepEqual(c.resultatsChanges.parTransition, { "NC→C": 1, "NA→NC": 1 });
  assert.deepEqual(c.criteresChanges, [{ critere: "1.1", avant: "NC", apres: "C" }, { critere: "1.2", avant: "C", apres: "NC" }]);
});

console.log(`${n} tests passés`);
