// =============================================================================
// app/api/parametres/banque-defaut/route.ts  --  S25 / F17 (Q9-b, Q20-a, Q25-b)
// =============================================================================
// Compte bancaire preselectionne dans le formulaire Decaissements. Stocke cote
// serveur (parametres."banqueDefautId") pour suivre l utilisateur sur tous ses
// appareils.
//
// Route dediee plutot qu une extension de PUT /api/parametres (S25-Q25-b) :
// un seul champ, aucune interaction avec le jeton de version des taux
// (P87, P101) ni avec tauxReference.
//
// SECURITE
//   - Session obligatoire ; CSRF sur PUT.
//   - Controle de propriete. La cle etrangere garantit que la banque EXISTE,
//     pas qu elle appartient a l utilisateur : sans ce controle, l identifiant
//     d une banque d un autre compte serait accepte (IDOR). Seules les banques
//     ACTIVES de l utilisateur sont acceptees.
//   - Audit avec valeur avant / apres ; aucune ecriture si rien ne change.
//
// LECTURE
//   Le GET renvoie la banque EFFECTIVE : si le compte par defaut a ete
//   desactive depuis (soft delete Q15), il renvoie null plutot qu un
//   identifiant que le formulaire ne pourrait pas afficher.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BanqueDefautSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/parametres/banque-defaut
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;

    const p = await prisma.parametres.findUnique({
      where:  { userId },
      select: { banqueDefautId: true },
    });

    let banque: { id: string; nomBanque: string } | null = null;
    if (p?.banqueDefautId) {
      banque = await prisma.banque.findFirst({
        where:  { id: p.banqueDefautId, userId, isActive: true },
        select: { id: true, nomBanque: true },
      });
    }

    const res = NextResponse.json({ banqueDefautId: banque?.id ?? null, banque });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (e: any) {
    console.error('GET /api/parametres/banque-defaut:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/parametres/banque-defaut
// Body : { banqueId: string | null }   (null = retirer le compte par defaut)
// ─────────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = validateBody(BanqueDefautSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { banqueId } = parsed.data;

    let nomBanque: string | null = null;
    if (banqueId !== null) {
      const banque = await prisma.banque.findFirst({
        where:  { id: banqueId, userId, isActive: true },
        select: { nomBanque: true },
      });
      if (!banque)
        return NextResponse.json({ error: 'Compte bancaire introuvable ou desactive' }, { status: 404 });
      nomBanque = banque.nomBanque;
    }

    const avant = await prisma.parametres.findUnique({
      where:  { userId },
      select: { id: true, banqueDefautId: true },
    });
    if (!avant)
      return NextResponse.json({ error: 'Parametres introuvables' }, { status: 404 });

    if (avant.banqueDefautId !== banqueId) {
      await prisma.parametres.update({
        where: { userId },
        data:  { banqueDefautId: banqueId },
      });

      await logAudit({
        userId,
        action:     'update',
        entityType: 'parametres',
        entityId:   avant.id,
        entityNom:  'banqueDefautId',
        details:    { avant: avant.banqueDefautId, apres: banqueId, nomBanque },
        req,
      });
    }

    return NextResponse.json({ success: true, banqueDefautId: banqueId, nomBanque });
  } catch (e: any) {
    console.error('PUT /api/parametres/banque-defaut:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
