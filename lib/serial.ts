// =============================================================================
// lib/serial.ts  --  I21 (S16)
// =============================================================================
// Ferme P78 : les objets Date etaient reduits a {}.
//     serial() reconstruisait chaque objet via Object.keys(). Un Date n a
//     aucune propriete propre enumerable : le walk le vidait integralement.
//     Symptome observe en prod : "updatedAt":{} sur /api/banques et /api/comptes.
//     Consequence bloquante : Q67 (concurrence optimiste sur PUT /api/budget)
//     suppose de renvoyer updatedAt au client et de refuser l ecriture s il a
//     change. Impossible tant que le champ ne survit pas au JSON.
//
// Ajout : garde de plage sur BigInt. Number(bigint) au-dela de 2^53 perd des
//     unites sans erreur. Sur des montants FCFA le plafond est loin, mais une
//     valeur corrompue en base sortirait fausse en silence. On journalise.
// =============================================================================

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(-Number.MAX_SAFE_INTEGER);

export function serial(obj: any): any {
  if (typeof obj === 'bigint') {
    if (obj > MAX_SAFE || obj < MIN_SAFE) {
      console.error('serial: BigInt hors plage sure ->', obj.toString());
    }
    return Number(obj);
  }

  // P78 -- doit passer AVANT le branchement objet.
  if (obj instanceof Date) return obj.toISOString();

  if (Array.isArray(obj)) return obj.map(serial);

  if (obj && typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }

  return obj;
}

export function toNum(v: any): number {
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}