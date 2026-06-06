import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth'; // ← même import que tes autres routes API
import { revalidateTag } from 'next/cache';

/**
 * POST /api/analytiques/invalidate
 *
 * Invalide le cache serveur (unstable_cache) des analytiques
 * pour l'utilisateur courant.
 *
 * À appeler côté client après toute mutation qui affecte :
 *   - BudgetMensuel  → /api/budget
 *   - Categorie      → /api/categories, /api/enveloppes
 *   - Annee          → /api/annees
 *
 * Exemple d'appel client :
 *   await fetch('/api/analytiques/invalidate', { method: 'POST' });
 */
export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Invalide toutes les périodes (3m, 6m, 12m) pour cet utilisateur en un seul appel
  // Le tag analytiques-{userId} est partagé entre tous les keys unstable_cache de ce user
  revalidateTag(`analytiques-${session.user.id}`);

  return NextResponse.json({ ok: true });
}
