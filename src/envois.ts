/**
 * Envoi des résultats par paquets, avec scission sur erreur serveur.
 *
 * Constaté le 01/10/2026 : Ara répond 500 à certains paquets de 23 à 36
 * résultats (thématiques 10 et 12) alors que chacun de ces résultats passe
 * seul. Plutôt que de faire échouer tout l'envoi, on découpe : paquets de
 * `taille` résultats, et un paquet refusé par une erreur 5xx est coupé en deux
 * jusqu'au résultat isolé. Un résultat refusé seul est rapporté, pas réessayé
 * indéfiniment. Les erreurs 4xx (requête invalide, droits) arrêtent tout :
 * les renvoyer en morceaux ne les corrigerait pas.
 *
 * Chaque envoi remplace l'évaluation des critères visés : renvoyer un paquet
 * déjà passé est sans effet de bord, ce qui rend la scission sûre.
 */

export interface Echec<T> {
  item: T;
  erreur: string;
}

export interface BilanEnvoi<T> {
  envoyes: number;
  requetes: number;
  scissions: number;
  echecs: Echec<T>[];
}

/** Vrai pour une erreur que le serveur a produite (5xx) ou un réseau coupé. */
export function erreurServeur(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  const statut = /Ara API error: (\d{3})/.exec(m);
  if (statut) return Number(statut[1]) >= 500;
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(m);
}

function message(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.split("\n")[0].slice(0, 300);
}

export async function envoyerParPaquets<T>(
  items: T[],
  envoyer: (paquet: T[]) => Promise<void>,
  taille = 20
): Promise<BilanEnvoi<T>> {
  const bilan: BilanEnvoi<T> = { envoyes: 0, requetes: 0, scissions: 0, echecs: [] };

  async function passer(paquet: T[]): Promise<void> {
    bilan.requetes++;
    try {
      await envoyer(paquet);
      bilan.envoyes += paquet.length;
    } catch (err) {
      if (!erreurServeur(err)) throw err;
      if (paquet.length === 1) {
        bilan.echecs.push({ item: paquet[0], erreur: message(err) });
        return;
      }
      bilan.scissions++;
      const milieu = Math.ceil(paquet.length / 2);
      await passer(paquet.slice(0, milieu));
      await passer(paquet.slice(milieu));
    }
  }

  for (let i = 0; i < items.length; i += taille) {
    try {
      await passer(items.slice(i, i + taille));
    } catch (err) {
      // Les paquets précédents sont enregistrés : le dire, sinon l'appelant
      // croirait que rien n'est passé et renverrait tout.
      const m = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${m}\n\nEnvoi interrompu : ${bilan.envoyes} résultat(s) sur ${items.length} déjà enregistré(s) avant cette erreur ` +
          `(les ${i} premiers du tableau, moins les éventuels refus isolés).`
      );
    }
  }
  return bilan;
}
