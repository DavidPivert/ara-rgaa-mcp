/**
 * Stockage local du jeton Ara.
 *
 * Objectif : que la configuration MCP ne contienne AUCUN secret. Le jeton vit
 * dans un fichier du dossier de configuration de l'utilisateur, en permissions
 * 600, écrit par `ara-rgaa-mcp login`.
 *
 * Seul le jeton est conservé — jamais le mot de passe. Les jetons d'Ara durent
 * 24 h, mais `/auth/refresh` en délivre un nouveau à partir d'un jeton encore
 * valide : le serveur rafraîchit au démarrage, si bien qu'un usage régulier ne
 * demande jamais de se réidentifier.
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, unlinkSync } from "node:fs";

export interface StoredCredentials {
  /** Jeton JWT Ara. */
  token: string;
  /** Compte auquel il appartient, pour l'afficher sans décoder le jeton. */
  username?: string;
  /** Instance visée, pour ne pas réutiliser un jeton d'une autre instance. */
  baseUrl: string;
  /** Date d'obtention ou du dernier rafraîchissement, en ISO 8601. */
  obtenuLe: string;
}

/** `~/.config/ara-rgaa-mcp/credentials.json`, ou l'équivalent XDG. */
export function credentialsPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim().length > 0
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), ".config");
  return join(base, "ara-rgaa-mcp", "credentials.json");
}

export function readCredentials(): StoredCredentials | null {
  const p = credentialsPath();
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as StoredCredentials;
    return typeof parsed?.token === "string" && parsed.token.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCredentials(creds: StoredCredentials): string {
  const p = credentialsPath();
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  // writeFileSync n'applique le mode qu'à la création : forcer si le fichier existait.
  chmodSync(p, 0o600);
  return p;
}

export function clearCredentials(): boolean {
  const p = credentialsPath();
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

/**
 * Âge du jeton, en heures. Les jetons d'Ara durent 24 h : au-delà, il faut
 * repasser par `login`.
 */
export function ageEnHeures(creds: StoredCredentials): number {
  const t = Date.parse(creds.obtenuLe);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}
