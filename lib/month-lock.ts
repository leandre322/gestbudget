import { createHmac } from 'crypto';

const SECRET = process.env.NEXTAUTH_SECRET ?? 'gestbudget-fallback-secret';

// ── Générer un token signé pour déverrouiller un mois ─────────────────────────
export function generateUnlockToken(userId: string, mois: number, annee: number): string {
  const ts   = Math.floor(Date.now() / 1000);
  const data = `${userId}:${mois}:${annee}:${ts}`;
  const hmac = createHmac('sha256', SECRET).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ userId, mois, annee, ts, hmac })).toString('base64url');
}

// ── Vérifier un token (expire après 60 minutes) ───────────────────────────────
export function verifyUnlockToken(
  token: string, userId: string, mois: number, annee: number
): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    const { userId: tUid, mois: tMois, annee: tAnnee, ts, hmac } = payload;

    // 1. Expiry — 60 minutes
    if (Date.now() / 1000 - ts > 3600) return false;

    // 2. Correspondance userId / mois / annee
    if (tUid !== userId || Number(tMois) !== Number(mois) || Number(tAnnee) !== Number(annee))
      return false;

    // 3. Vérification HMAC
    const data     = `${tUid}:${tMois}:${tAnnee}:${ts}`;
    const expected = createHmac('sha256', SECRET).update(data).digest('hex');
    return hmac === expected;
  } catch {
    return false;
  }
}

// ── Déterminer si un mois est passé ───────────────────────────────────────────
export function isMonthPast(mois: number, annee: number): boolean {
  const now = new Date();
  return annee < now.getFullYear() ||
    (annee === now.getFullYear() && mois < now.getMonth() + 1);
}

// ── Vérifier l'accès à un mois (header X-GestBudget-Unlock) ─────────────────
export async function checkMonthAccess(
  req: Request, userId: string, mois: number, annee: number
): Promise<boolean> {
  if (!isMonthPast(mois, annee)) return true; // Mois courant → toujours autorisé

  const token = req.headers.get('x-gestbudget-unlock');
  if (!token) return false;

  return verifyUnlockToken(token, userId, Number(mois), Number(annee));
}
