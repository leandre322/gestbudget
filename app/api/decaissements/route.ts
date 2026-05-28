import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function serial(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serial);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }
  return obj;
}

// ── Helper : upsert budget mensuel (ajoute ou soustrait au montantReel) ──────
async function upsertBudgetMensuel(
  userId: string, anneeId: string, categorieId: string,
  mois: number, montant: bigint, action: 'add' | 'subtract'
) {
  const existing = await prisma.budgetMensuel.findFirst({
    where: { userId, anneeId, categorieId, mois },
  });
  if (existing) {
    const current = BigInt(Number(existing.montantReel ?? 0));
    const newVal  = action === 'add' ? current + montant : current - montant;
    await prisma.budgetMensuel.update({
      where: { id: existing.id },
      data:  { montantReel: newVal < BigInt(0) ? BigInt(0) : newVal, updatedAt: new Date() },
    });
  } else if (action === 'add') {
    await prisma.budgetMensuel.create({
      data: { userId, anneeId, categorieId, mois, montantAnticipe: BigInt(0), montantReel: montant },
    });
  }
}

// ── Helper : trouver ou créer l'enregistrement Annee ─────────────────────────
async function getOrCreateAnnee(userId: string, annee: number) {
  let anneeRec = await prisma.annee.findUnique({
    where: { userId_annee: { userId, annee } },
  });
  if (!anneeRec) {
    anneeRec = await prisma.annee.create({
      data: { userId, annee },
    });
  }
  return anneeRec;
}

// GET /api/decaissements?annee=2026
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const anneeParam = searchParams.get('annee');
    const annee      = anneeParam ? parseInt(anneeParam) : null;

    const comptes = await prisma.compteFonds.findMany({
      where:   { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    let anneeRec = null;
    if (annee) {
      anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId: session.user.id, annee } },
      });
    }

    const whereClause = anneeRec
      ? { userId: session.user.id, anneeId: anneeRec.id }
      : { userId: session.user.id };

    const decaissements = await prisma.decaissement.findMany({
      where:   whereClause,
      include: { repartitions: { include: { compte: true } } },
      orderBy: { dateOperation: 'desc' },
      take:    200,
    });

    return NextResponse.json(serial({ comptes, decaissements, anneeId: anneeRec?.id ?? null }));
  } catch (e: any) {
    console.error('GET /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// POST /api/decaissements
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const {
      description, dateOperation, notes, typeMouvement,
      montantTotal,   // optionnel — impacte "Autres revenus" (ajout) ou "Autre dépense 1" (retrait)
      compteId,       // fond ciblé — impacte soldeActuel + catégorie epargne_autre du mois
      banqueId,       // banque — impacte solde bancaire + catégorie epargne_precaution du mois (optionnel)
      montantFond,    // montant sur le fond (peut différer de montantTotal)
      montantBanque,  // montant sur la banque (optionnel)
      impacterBanque,
    } = await req.json();

    if (!description || !dateOperation) {
      return NextResponse.json({ error: 'Description et date obligatoires' }, { status: 400 });
    }

    const mouvType   = typeMouvement ?? 'retrait';
    const isAjout    = mouvType === 'ajout';

    // Montants
    const mtTotal  = montantTotal  ? BigInt(Math.round(Number(montantTotal)))  : BigInt(0);
    const mtFond   = montantFond   ? BigInt(Math.round(Number(montantFond)))   : BigInt(0);
    const mtBanque = montantBanque ? BigInt(Math.round(Number(montantBanque))) : BigInt(0);

    // Montant à stocker dans decaissements (le plus grand des deux, ou total si fourni)
    const mtDecaissement = mtTotal > BigInt(0) ? mtTotal : mtFond > BigInt(0) ? mtFond : mtBanque;

    // Date → mois/année
    const opDate  = new Date(dateOperation);
    const opMois  = opDate.getMonth() + 1;
    const opAnnee = opDate.getFullYear();

    // ── 1. Créer le décaissement ─────────────────────────────────────────
    const dec = await prisma.decaissement.create({
      data: {
        userId:        session.user.id,
        anneeId:       null, // sera mis à jour après
        description,
        dateOperation: opDate,
        montantTotal:  mtDecaissement,
        notes:         notes ?? null,
        typeMouvement: mouvType,
      },
    });

    // ── 2. Trouver/créer l'année ─────────────────────────────────────────
    const anneeRec = await getOrCreateAnnee(session.user.id, opAnnee);

    // Mettre à jour anneeId du décaissement
    await prisma.decaissement.update({
      where: { id: dec.id },
      data:  { anneeId: anneeRec.id },
    });

    // ── 3. Impact "Autres revenus" ou "Autre dépense 1" ──────────────────
    if (mtTotal > BigInt(0)) {
      const catNomRecherche = isAjout ? 'Autres revenus' : 'Autre dépense';
      const catTypeRecherche = isAjout ? 'revenu' : 'depense_occasionnelle';

      const catImpact = await prisma.categorie.findFirst({
        where: {
          userId:   session.user.id,
          type:     catTypeRecherche,
          isActive: true,
          nom:      { contains: catNomRecherche, mode: 'insensitive' },
        },
      });

      if (catImpact) {
        await upsertBudgetMensuel(session.user.id, anneeRec.id, catImpact.id, opMois, mtTotal, 'add');
      }
    }

    // ── 4. Impact fond de fonctionnement ─────────────────────────────────
    if (compteId && mtFond > BigInt(0)) {
      // 4a. Mettre à jour soldeActuel du fond
      const compte = await prisma.compteFonds.findFirst({
        where:  { id: compteId, userId: session.user.id },
        select: { soldeActuel: true, nom: true },
      });
      if (compte) {
        const solde    = BigInt(Number(compte.soldeActuel ?? 0));
        const newSolde = isAjout ? solde + mtFond : solde - mtFond;
        await prisma.compteFonds.update({
          where: { id: compteId },
          data:  { soldeActuel: newSolde < BigInt(0) ? BigInt(0) : newSolde, updatedAt: new Date() },
        });

        // Créer répartition
        await prisma.decaissementCompte.create({
          data: { decaissementId: dec.id, compteId, montant: mtFond },
        });

        // 4b. Impact catégorie epargne_autre liée dans budget mensuel
        // Priorité : liaison compteFondsId, sinon matching par nom
        const catFond = await prisma.categorie.findFirst({
          where: { userId: session.user.id, compteFondsId: compteId, isActive: true, type: 'epargne_autre' },
        }) ?? await prisma.categorie.findFirst({
          where: {
            userId: session.user.id, isActive: true, type: 'epargne_autre',
            nom: { contains: compte.nom, mode: 'insensitive' },
          },
        });

        if (catFond) {
          await upsertBudgetMensuel(
            session.user.id, anneeRec.id, catFond.id, opMois, mtFond,
            isAjout ? 'add' : 'subtract'
          );
        }
      }
    }

    // ── 5. Impact banque ─────────────────────────────────────────────────
    if (impacterBanque && banqueId && mtBanque > BigInt(0)) {
      const banque = await prisma.banque.findFirst({
        where:  { id: banqueId, userId: session.user.id },
        select: { solde: true, nomBanque: true },
      });
      if (banque) {
        const solde       = BigInt(Number(banque.solde ?? 0));
        // Ajout fond = argent quitte la banque ; Retrait fond = argent entre en banque
        const newSolde    = isAjout ? solde - mtBanque : solde + mtBanque;
        await prisma.banque.update({
          where: { id: banqueId },
          data:  { solde: newSolde < BigInt(0) ? BigInt(0) : newSolde, updatedAt: new Date() },
        });

        // 5b. Impact catégorie epargne_precaution dans budget mensuel
        const catBanque = await prisma.categorie.findFirst({
          where: {
            userId: session.user.id, isActive: true, type: 'epargne_precaution',
            nom: { contains: banque.nomBanque, mode: 'insensitive' },
          },
        }) ?? await prisma.categorie.findFirst({
          where: { userId: session.user.id, isActive: true, type: 'epargne_precaution' },
        });

        if (catBanque) {
          await upsertBudgetMensuel(
            session.user.id, anneeRec.id, catBanque.id, opMois, mtBanque,
            isAjout ? 'subtract' : 'add'
          );
        }
      }
    }

    return NextResponse.json(serial({ success: true, id: dec.id }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// DELETE /api/decaissements?id=xxx — supprime et annule l'impact sur les soldes
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const dec = await prisma.decaissement.findFirst({
      where:   { id, userId: session.user.id },
      include: { repartitions: true },
    });
    if (!dec) return NextResponse.json({ error: 'Décaissement introuvable' }, { status: 404 });

    const montantBigInt = BigInt(Number(dec.montantTotal ?? 0));
    const isAjout       = dec.typeMouvement === 'ajout';

    // ── Annuler l'impact sur les CompteFonds ─────────────────────────────
    for (const rep of dec.repartitions) {
      const compte = await prisma.compteFonds.findFirst({
        where:  { id: rep.compteId, userId: session.user.id },
        select: { soldeActuel: true },
      });
      if (compte) {
        const repMontant  = BigInt(Number(rep.montant ?? 0));
        const soldeActuel = BigInt(Number(compte.soldeActuel ?? 0));
        // Inverser le mouvement
        const newSolde    = isAjout ? soldeActuel - repMontant : soldeActuel + repMontant;
        await prisma.compteFonds.update({
          where: { id: rep.compteId },
          data:  { soldeActuel: newSolde < BigInt(0) ? BigInt(0) : newSolde, updatedAt: new Date() },
        });
      }
    }

    await prisma.decaissement.delete({ where: { id, userId: session.user.id } });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
