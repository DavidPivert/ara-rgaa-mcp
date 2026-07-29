#!/usr/bin/env node
/**
 * Régénère src/rgaa-data.ts depuis les sources du projet Ara.
 *
 * Le référentiel RGAA n'a pas d'API publique : il vit dans le dépôt d'Ara,
 * sous Licence Ouverte 2.0. Ce script le récupère, en retire les liens de
 * glossaire et les backticks (bruit pour un agent), et l'embarque dans le
 * paquet — le serveur reste ainsi utilisable hors ligne et déterministe.
 *
 * À relancer quand le RGAA évolue :  node scripts/build-rgaa-data.mjs
 */
import { writeFileSync } from "node:fs";

const RAW = "https://raw.githubusercontent.com/DISIC/Ara/main";
const strip = (s) =>
  s
    .replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1")
    .replace(/``([^`]+)``/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const rgaa = await (await fetch(`${RAW}/confiture-rest-api/src/rgaa.json`)).json();
const criteriaSrc = await (
  await fetch(`${RAW}/confiture-rest-api/src/audits/criteria.ts`)
).text();

const list = (name) => {
  const m = criteriaSrc.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`${name} introuvable dans criteria.ts`);
  return [...m[1].matchAll(/topic:\s*(\d+),\s*criterium:\s*(\d+)/g)].map(
    (x) => `${x[1]}.${x[2]}`
  );
};

const topics = rgaa.topics.map((t) => ({
  number: t.number,
  name: t.topic,
  criteria: t.criteria.map((c) => ({
    number: c.criterium.number,
    title: strip(c.criterium.title),
    tests: Object.entries(c.criterium.tests).map(([number, statements]) => ({
      number,
      statements: statements.map(strip),
    })),
  })),
}));

const total = topics.reduce((a, t) => a + t.criteria.length, 0);
if (total !== 106) throw new Error(`106 critères attendus, ${total} trouvés`);

writeFileSync(
  new URL("../src/rgaa-data.ts", import.meta.url),
  `// AUTO-GENERATED — ne pas éditer à la main.
//
// Référentiel RGAA 4.1, extrait de confiture-rest-api/src/rgaa.json du projet
// Ara (https://github.com/DISIC/Ara), publié par la DINUM.
//
// Les contenus du dépôt Ara sont sous Licence Ouverte 2.0, qui autorise la
// réutilisation et la rediffusion sous réserve de mentionner la paternité.
// Attribution : Direction interministérielle du numérique (DINUM) — RGAA 4.1.
//
// Les listes FAST / COMPLEMENTARY reprennent celles de
// confiture-rest-api/src/audits/criteria.ts. Elles sont DISJOINTES : un audit
// de type COMPLEMENTARY porte les 25 critères complémentaires, la méthodologie
// complète (rapide + complémentaire) en couvrant 50.
//
// Régénérer : node scripts/build-rgaa-data.mjs

export interface RgaaTest { number: string; statements: string[] }
export interface RgaaCriterion { number: number; title: string; tests: RgaaTest[] }
export interface RgaaTopic { number: number; name: string; criteria: RgaaCriterion[] }

export const RGAA_VERSION = "4.1";

export const RGAA_TOPICS: RgaaTopic[] = ${JSON.stringify(topics)};

/** Critères de l’audit rapide (25). */
export const FAST_CRITERIA: string[] = ${JSON.stringify(list("FAST_CRITERIA"))};

/** Critères de l’audit complémentaire (25), disjoints des précédents. */
export const COMPLEMENTARY_CRITERIA: string[] = ${JSON.stringify(list("COMPLEMENTARY_CRITERIA"))};
`
);
console.log(`src/rgaa-data.ts régénéré — ${topics.length} thématiques, ${total} critères`);
