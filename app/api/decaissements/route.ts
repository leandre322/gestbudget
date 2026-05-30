import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// ── Sérialisation BigInt/Date ─────────────────────────────────────────────────
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

// ── Trouver ou créer l'enregistrement Annee (dans transaction) ────────────────
async function getOrCreateAnnee(tx: any, userId: string, annee: number) {
  let rec = await tx.annee.findUnique({
    where: { userId_annee: { userId, annee } },
  });
  if (!rec) rec = await tx.annee.create({ data: { userId, annee } });
  return rec;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/decaissements?annee=2026&limit=100&offset=0
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const anneeParam = searchParams.get('annee');
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '100'), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0');

    // Filtre par année si fourni
    const anneeRec = anneeParam
      ? await prisma.annee.findUnique({
          where: { userId_annee: { userId: session.user.id, annee: parseInt(anneeParam) } },
        })
      : null;

    const where = {
      userId: session.user.id,
      ...(anneeRec ? { anneeId: anneeRec.id } : {}),
    };

    const [decaissements, total] = await Promise.all([
      prisma.decaissement.findMany({
        where,
        include: { repartitions: { include: { compte: true } } },
        orderBy: { dateOperation: 'desc' },
        take:    limit,
        skip:    offset,
      }),
      prisma.decaissement.count({ where }),
    ]);

    return NextResponse.json(serial({ decaissements, total, anneeId: anneeRec?.id ?? null }));
  } catch (e: any) {
    console.error('GET /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/decaissements
// Règle absolue : ne JAMAIS écrire dans budget_mensuel depuis cette route
// Impact exclusif : comptes_fonds.soldeActuel et/ou banques.solde
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await req.json();
    const {
      description, dateOperation, notes, typeMouvement,
      compteId, banqueId,
      montantFond, montantBanque,
      impacterBanque,
    } = body;

    if (!description || !dateOperation)
      return NextResponse.json({ error: 'Description et date obligatoires' }, { status: 400 });

    const mouvType = typeMouvement ?? 'retrait';
    const isAjout  = mouvType === 'ajout';

    const mtFond   = BigInt(Math.round(Math.max(0, Number(montantFond)   || 0)));
    const mtBanque = BigInt(Math.round(Math.max(0, Number(montantBanque) || 0)));

    if (mtFond === BigInt(0) && mtBanque === BigInt(0))
      return NextResponse.json({ error: 'Saisissez au moins un montant' }, { status: 400 });

    const opDate  = new Date(dateOperation);
    const opAnnee = opDate.getFullYear();

    let result: any;

    try {
      result = await prisma.$transaction(async (tx) => {
        let soldeAvantFond:    bigint = BigInt(0);
        let soldeApresFond:    bigint = BigInt(0);
        let soldeAvantBanque:  bigint = BigInt(0);
        let soldeApresBanque:  bigint = BigInt(0);

        // ── 1. Impact sur le fond ───────────────────────────────────────
        if (compteId && mtFond > BigInt(0)) {
          const compte = await tx.compteFonds.findFirst({
            where:  { id: compteId, userId: session.user.id },
            select: { soldeActuel: true, nom: true },
          });
          if (!compte)
            throw Object.assign(new Error('COMPTE_INTROUVABLE'), { code: 404 });

          soldeAvantFond = BigInt(Number(compte.soldeActuel ?? 0));

          // Vérification solde insuffisant pour un retrait
          if (!isAjout && soldeAvantFond < mtFond) {
            throw Object.assign(new Error('SOLDE_INSUFFISANT'), {
              code: 422,
              details: `${compte.nom} : disponible ${Number(soldeAvantFond).toLocaleString('fr-FR')} FCFA, demandé ${Number(mtFond).toLocaleString('fr-FR')} FCFA`,
            });
          }

          soldeApresFond = isAjout
            ? soldeAvantFond + mtFond
            : soldeAvantFond - mtFond;

          await tx.compteFonds.update({
            where: { id: compteId },
            data:  { soldeActuel: soldeApresFond, updatedAt: new Date() },
          });
        }

        // ── 2. Impact sur la banque (mode transfert uniquement) ─────────
        const doBanque = impacterBanque && banqueId && mtBanque > BigInt(0);
        if (doBanque) {
          const banque = await tx.banque.findFirst({
            where:  { id: banqueId, userId: session.user.id },
            select: { solde: true },
          });
          if (!banque)
            throw Object.assign(new Error('BANQUE_INTROUVABLE'), { code: 404 });

          soldeAvantBanque = BigInt(Number(banque.solde ?? 0));

          // Logique transfert : ajout fond = argent quitte banque ; retrait fond = argent entre banque
          const rawApres = isAjout
            ? soldeAvantBanque - mtBanque
            : soldeAvantBanque + mtBanque;
          soldeApresBanque = rawApres < BigInt(0) ? BigInt(0) : rawApres;

          await tx.banque.update({
            where: { id: banqueId },
            data:  { solde: soldeApresBanque, updatedAt: new Date() },
          });
        }

        // ── 3. Créer l'enregistrement decaissement (historique) ─────────
        const anneeRec = await getOrCreateAnnee(tx, session.user.id, opAnnee);

        const dec = await tx.decaissement.create({
          data: {
            userId:          session.user.id,
            anneeId:         anneeRec.id,
            description,
            dateOperation:   opDate,
            // montantTotal conservé pour compat affichage existant
            montantTotal:    mtFond > BigInt(0) ? mtFond : mtBanque,
            // Nouveaux champs pour rollback complet
            montantFond,
            montantBanque:   doBanque ? mtBanque : BigInt(0),
            banqueId:        doBanque ? banqueId : null,
            notes:           notes ?? null,
            typeMouvement:   mouvType,
            soldeAvantFond:  soldeAvantFond  > BigInt(0) ? soldeAvantFond  : null,
            soldeApresFond:  soldeApresFond  > BigInt(0) ? soldeApresFond  : null,
            soldeAvantBanque: doBanque && soldeAvantBanque >= BigInt(0) ? soldeAvantBanque : null,
            soldeApresBanque: doBanque                                   ? soldeApresBanque : null,
          },
        });

        // ── 4. Répartition fond ────────────────────────────────────────
        if (compteId && mtFond > BigInt(0)) {
          await tx.decaissementCompte.create({
            data: { decaissementId: dec.id, compteId, montant: mtFond },
          });
        }

        // ══ AUCUNE ÉCRITURE DANS budget_mensuel ══
        // Le suivi mensuel et le dashboard Mois Courant ne sont JAMAIS
        // impactés par les opérations Ajout/Retrait Fonds.

        return dec;
      });
    } catch (txErr: any) {
      if (txErr.message === 'SOLDE_INSUFFISANT')
        return NextResponse.json({ error: txErr.details }, { status: 422 });
      if (txErr.message === 'COMPTE_INTROUVABLE')
        return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });
      if (txErr.message === 'BANQUE_INTROUVABLE')
        return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
      throw txErr;
    }

    return NextResponse.json(serial({ success: true, id: result.id }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/decaissements?id=xxx
// Rollback complet : fond + banque restaurés via transaction atomique
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      const dec = await tx.decaissement.findFirst({
        where:   { id, userId: session.user.id },
        include: { repartitions: true },
      });
      if (!dec) throw Object.assign(new Error('NOT_FOUND'), { code: 404 });

      const isAjout = dec.typeMouvement === 'ajout';

      // ── Reverser l'impact sur les fonds ──────────────────────────────
      for (const rep of dec.repartitions) {
        const repMt = BigInt(Number(rep.montant ?? 0));
        if (repMt === BigInt(0)) continue;

        const compte = await tx.compteFonds.findFirst({
          where:  { id: rep.compteId, userId: session.user.id },
          select: { soldeActuel: true },
        });
        if (!compte) continue;

        const solde = BigInt(Number(compte.soldeActuel ?? 0));
        // Inverser : ajout → on soustrait ; retrait → on ajoute
        const rawApres = isAjout ? solde - repMt : solde + repMt;
        await tx.compteFonds.update({
          where: { id: rep.compteId },
          data:  { soldeActuel: rawApres < BigInt(0) ? BigInt(0) : rawApres, updatedAt: new Date() },
        });
      }

      // ── Reverser l'impact sur la banque ──────────────────────────────
      const decAny    = dec as any;
      const mtBanque  = BigInt(Number(decAny.montantBanque ?? 0));
      if (decAny.banqueId && mtBanque > BigInt(0)) {
        const banque = await tx.banque.findFirst({
          where:  { id: decAny.banqueId, userId: session.user.id },
          select: { solde: true },
        });
        if (banque) {
          const solde = BigInt(Number(banque.solde ?? 0));
          // Inverser le transfert : ajout fond avait soustrait banque → on rajoute
          const rawApres = isAjout ? solde + mtBanque : solde - mtBanque;
          await tx.banque.update({
            where: { id: decAny.banqueId },
            data:  { solde: rawApres < BigInt(0) ? BigInt(0) : rawApres, updatedAt: new Date() },
          });
        }
      }

      await tx.decaissement.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'NOT_FOUND')
      return NextResponse.json({ error: 'Décaissement introuvable' }, { status: 404 });
    console.error('DELETE /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
