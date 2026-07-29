/**
 * `ara-rgaa-mcp login` — obtenir un jeton Ara sans rien coller nulle part.
 *
 * Ouvre une page sur 127.0.0.1 avec un formulaire e-mail / mot de passe, appelle
 * `/auth/signin`, et range le jeton dans le fichier de configuration. La
 * configuration MCP n'a alors plus besoin de contenir le moindre secret.
 *
 * Précautions, parce qu'une page locale qui réclame des identifiants ressemble
 * à du hameçonnage :
 *   - écoute uniquement sur 127.0.0.1, jamais sur une interface publique ;
 *   - l'URL comporte un jeton aléatoire, qu'une autre page locale ne peut pas
 *     deviner ;
 *   - à usage unique : le serveur s'arrête dès la réussite ;
 *   - l'URL exacte est affichée dans le terminal, à comparer avec celle du
 *     navigateur avant de saisir quoi que ce soit.
 *
 * Le mot de passe ne transite que du navigateur vers ce processus local, puis
 * vers Ara. Il n'est jamais écrit sur le disque.
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { AraClient } from "./ara-client.js";
import { writeCredentials, credentialsPath } from "./credentials.js";

const echapper = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Ouvre l'URL dans le navigateur par défaut, sans échouer si c'est impossible. */
function ouvrirNavigateur(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  } catch {
    /* l'utilisateur ouvrira l'URL à la main */
  }
}

function page(corps: string, titre: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapper(titre)} — ara-rgaa-mcp</title>
<style>
  :root { color-scheme: light dark }
  body { font-family: system-ui, sans-serif; line-height: 1.5; max-width: 34rem;
         margin: 3rem auto; padding: 0 1.25rem; color: #1b1b1b; background: #fff }
  @media (prefers-color-scheme: dark) { body { color: #ededed; background: #161616 } }
  h1 { font-size: 1.5rem; margin-bottom: .25rem }
  .sous-titre { color: #666; margin-top: 0 }
  @media (prefers-color-scheme: dark) { .sous-titre { color: #aaa } }
  label { display: block; font-weight: 600; margin-top: 1.25rem }
  input { width: 100%; padding: .6rem .7rem; margin-top: .3rem; font-size: 1rem;
          border: 2px solid #6a6a6a; border-radius: 4px; background: transparent; color: inherit }
  input:focus-visible { outline: 3px solid #0a58ca; outline-offset: 2px }
  button { margin-top: 1.5rem; padding: .7rem 1.4rem; font-size: 1rem; font-weight: 600;
           border: 0; border-radius: 4px; background: #000091; color: #fff; cursor: pointer }
  button:focus-visible { outline: 3px solid #0a58ca; outline-offset: 2px }
  .encadre { border-left: 4px solid #000091; padding: .75rem 1rem; margin: 1.5rem 0;
             background: rgba(0,0,145,.06) }
  .erreur { border-left-color: #b60000; background: rgba(182,0,0,.08) }
  code { font-size: .95em }
</style>
</head>
<body>
${corps}
</body>
</html>
`;
}

function formulaire(erreur?: string): string {
  return page(
    `<h1>Connexion à Ara</h1>
<p class="sous-titre">pour le serveur MCP <code>ara-rgaa-mcp</code></p>

<div class="encadre">
  <p><strong>Cette page tourne sur votre ordinateur</strong>, à l'adresse affichée dans votre terminal. Vos identifiants ne sont envoyés qu'à <code>ara.numerique.gouv.fr</code>, et votre mot de passe n'est jamais enregistré.</p>
  <p>Si vous n'avez pas lancé <code>ara-rgaa-mcp login</code> vous-même, fermez cette page.</p>
</div>

${erreur ? `<div class="encadre erreur"><p><strong>Échec de la connexion.</strong> ${echapper(erreur)}</p></div>` : ""}

<form method="post">
  <label for="username">Adresse e-mail du compte Ara</label>
  <input id="username" name="username" type="email" autocomplete="username" required autofocus>

  <label for="password">Mot de passe</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>

  <button type="submit">Se connecter</button>
</form>`,
    "Connexion"
  );
}

function succes(chemin: string, username: string): string {
  return page(
    `<h1>Connexion réussie</h1>
<p class="sous-titre">${echapper(username)}</p>
<div class="encadre">
  <p>Le jeton a été enregistré dans&nbsp;: <code>${echapper(chemin)}</code></p>
  <p>Vous pouvez fermer cette page. Votre client MCP n'a besoin d'aucun identifiant dans sa configuration.</p>
</div>`,
    "Connexion réussie"
  );
}

export async function runLogin(baseUrl: string): Promise<number> {
  const nonce = randomBytes(16).toString("hex");
  const client = new AraClient({ baseUrl });

  return new Promise((resolve) => {
    const serveur = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== `/${nonce}`) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }

      const repondre = (code: number, html: string) => {
        res.writeHead(code, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
      };

      if (req.method === "GET") return repondre(200, formulaire());

      if (req.method === "POST") {
        let corps = "";
        for await (const c of req) {
          corps += c;
          if (corps.length > 8_192) break; // un formulaire de connexion ne pèse pas davantage
        }
        const params = new URLSearchParams(corps);
        const username = (params.get("username") ?? "").trim();
        const password = params.get("password") ?? "";
        try {
          const token = await client.signin(username, password);
          const chemin = writeCredentials({
            token,
            username,
            baseUrl,
            obtenuLe: new Date().toISOString(),
          });
          repondre(200, succes(chemin, username));
          console.error(`\n✓ Connecté en tant que ${username}`);
          console.error(`  Jeton enregistré dans ${chemin} (permissions 600).`);
          console.error(`\n  Votre configuration MCP n'a plus besoin d'identifiants :`);
          console.error(`  { "command": "npx", "args": ["-y", "ara-rgaa-mcp"] }\n`);
          setTimeout(() => {
            serveur.close();
            resolve(0);
          }, 250);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const lisible = /401/.test(message)
            ? "Adresse e-mail ou mot de passe incorrect."
            : message;
          repondre(401, formulaire(lisible));
        }
        return;
      }

      res.writeHead(405, { Allow: "GET, POST" });
      res.end();
    });

    serveur.listen(0, "127.0.0.1", () => {
      const adresse = serveur.address();
      const port = typeof adresse === "object" && adresse ? adresse.port : 0;
      const url = `http://127.0.0.1:${port}/${nonce}`;
      console.error("Connexion à Ara — ouverture du navigateur…\n");
      console.error(`  ${url}\n`);
      console.error("Si rien ne s'ouvre, copiez cette adresse dans votre navigateur.");
      console.error("Vérifiez qu'elle correspond exactement avant de saisir vos identifiants.");
      console.error("Ctrl+C pour annuler.\n");
      ouvrirNavigateur(url);
    });
  });
}

export { credentialsPath };
