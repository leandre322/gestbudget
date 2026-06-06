import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';

const GlissementSchema = z.object({
  fromId:  z.string().min(1),
  toId:    z.string().min(1),
  montant: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 });
  }

  const parsed = GlissementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Donnees invalides', errors: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { fromId, toId, montant } = parsed.data;

  if (fromId === toId) {
    return NextResponse.json({ message: 'Source et cible identiques' }, { status: 422 });
  }

  // Vérification des deux catégories
  const [from, to] = await Promise.all([
    prisma.categorie.findUnique({ where: { id: fromId } }),
    prisma.categorie.findUnique({ where: { id: toId } }),
  ]);

  if (!from || from.userId !== userId) {
    return NextResponse.json({ message: 'Categorie source introuvable' }, { status: 404 });
  }
  if (!to || to.userId !== userId) {
    return NextResponse.json({ message: 'Categorie cible introuvable' }, { status: 404 });
  }
  if (!from.enveloppeActive || !to.enveloppeActive) {
    return NextResponse.json(
      { message: 'Les deux categories doivent avoir une enveloppe active' },
      { status: 422 },
    );
  }

  const montantBig = BigInt(montant);
  const newFrom    = from.montantReference - montantBig;
  const newTo      = to.montantReference   + montantBig;

  if (newFrom < BigInt(0)) {
    return NextResponse.json(
      { message: `Montant superieur au budget disponible (${Number(from.montantReference)} FCFA)` },
      { status: 422 },
    );
  }

  // Transaction atomique
  await prisma.$transaction([
    prisma.categorie.update({ where: { id: fromId }, data: { montantReference: newFrom } }),
    prisma.categorie.update({ where: { id: toId },   data: { montantReference: newTo   } }),
  ]);

  // Audit log
  await logAudit({
    userId,
    action:     'update',
    entityType: 'enveloppe_glissement',
    entityId:   fromId,
    entityNom:  `${from.nom} → ${to.nom}`,
    details: {
      fromId,
      fromNom:            from.nom,
      ancienMontantFrom:  from.montantReference.toString(),
      nouveauMontantFrom: newFrom.toString(),
      toId,
      toNom:              to.nom,
      ancienMontantTo:    to.montantReference.toString(),
      nouveauMontantTo:   newTo.toString(),
      montantGlisse:      montant,
    },
    req,
  });

  return NextResponse.json({
    ok:   true,
    from: { id: fromId, montantReference: Number(newFrom) },
    to:   { id: toId,   montantReference: Number(newTo)   },
  });
}
