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

/**
 * Ce dont on a besoin, EN PLUS du code source, pour trancher un critère.
 *
 * Cette classification est une GUIDANCE DE CE SERVEUR, pas une prescription du
 * RGAA : le référentiel dit quoi vérifier, pas avec quel outil. Elle est
 * déduite du vocabulaire des tests, puis corrigée à la main là où l'expérience
 * de terrain contredit l'heuristique.
 */
const SIGNAUX = {
  clavier: /au clavier|tabulation|prise de focus|pi[èe]ge au clavier|\bfocus\b/i,
  rendu: /couleur|contraste|feuilles? de styles?|visuellement|zoom|agrandissement|survol|reste visible|visible [àa] l/i,
  restitution: /restitu|technologies? d.assistance|nom accessible|WAI-ARIA/i,
  humain: /pertinent|compr[ée]hensible|explicite|[ée]quivalent|de m[êe]me sens/i,
};

/** Corrections manuelles, appuyées sur des audits réels. */
const CORRECTIONS = {
  // « la prise de focus est-elle visible ? » : il faut tabuler ET regarder.
  "10.7": ["clavier", "rendu"],
  // composants scriptés : rôle, nom et états s'observent dans l'arbre d'accessibilité.
  "7.1": ["restitution"],
  "7.2": ["restitution"],
  "7.4": ["restitution"],
  "7.5": ["restitution"],
};

const methodesPour = (id, texte) =>
  CORRECTIONS[id] ??
  Object.entries(SIGNAUX).filter(([, re]) => re.test(texte)).map(([k]) => k);

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
    besoins: methodesPour(
      `${t.number}.${c.criterium.number}`,
      [c.criterium.title, ...Object.values(c.criterium.tests).flat()].map(strip).join(" ")
    ),
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

export type RgaaBesoin = "clavier" | "rendu" | "restitution" | "humain";

export interface RgaaTest { number: string; statements: string[] }
export interface RgaaCriterion {
  number: number;
  title: string;
  tests: RgaaTest[];
  /** Ce qu'il faut EN PLUS du code source. Vide = le source suffit. */
  besoins: RgaaBesoin[];
}
export interface RgaaTopic { number: number; name: string; criteria: RgaaCriterion[] }

export const RGAA_VERSION = "4.1";

/**
 * Comment satisfaire chaque besoin. Guidance de ce serveur, pas du RGAA.
 */
export const GUIDE_BESOINS: Record<RgaaBesoin, string> = {
  clavier:
    "Naviguer réellement au clavier dans la page rendue : tabuler depuis le haut, relever chaque arrêt, vérifier que le focus progresse sans blocage et que l'on peut ressortir de chaque composant.",
  rendu:
    "Ouvrir la page dans un navigateur et observer le rendu : styles calculés, couleurs et contrastes réels, comportement une fois les feuilles de styles désactivées. Le code source seul ne dit pas ce qui est affiché.",
  restitution:
    "Inspecter l'arbre d'accessibilité de la page rendue (rôle, nom accessible, états de chaque composant). Un lecteur d'écran (NVDA, VoiceOver) reste nécessaire pour les cas fins : ordre et formulation des annonces, régions live.",
  humain:
    "Exige un jugement éditorial : pertinence d'un intitulé, équivalence de sens, compréhensibilité. Aucune inspection automatique ne tranche seule — la décision revient à l'auditeur.",
};

export const RGAA_TOPICS: RgaaTopic[] = ${JSON.stringify(topics)};

/** Critères de l’audit rapide (25). */
export const FAST_CRITERIA: string[] = ${JSON.stringify(list("FAST_CRITERIA"))};

/** Critères de l’audit complémentaire (25), disjoints des précédents. */
export const COMPLEMENTARY_CRITERIA: string[] = ${JSON.stringify(list("COMPLEMENTARY_CRITERIA"))};
`
);
console.log(`src/rgaa-data.ts régénéré — ${topics.length} thématiques, ${total} critères`);
