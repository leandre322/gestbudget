import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { estSortie } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// S25 / F17 — modifications de ce fichier (S25-Q28)
//
// Depuis F17, une jambe bancaire de decaissement (modes 'banque' et
// 'transfert') ecrit une ligne mouvements_banque portant decaissementId
// (Q19-a). Sans precaution, les KPI comptaient deux fois la meme sortie :
// une fois via decaissements, une fois via le journal.
//
// Regle retenue : une ligne LIEE compte tant que son decaissement EXISTE.
//   - Les KPI Banques restent alimentes par le journal seul, donc une depense
//     payee depuis un compte bancaire y figure bien (elle y etait absente
//     avant F17 : la jambe bancaire des transferts n etait pas journalisee).
//   - A l annulation (Q14-b), la ligne d origine ET sa compensation pointent
//     vers un decaissement supprime : les deux sont ecartees ensemble et le
//     KPI revient exactement a son etat anterieur, sans traitement special.
//
// Les KPI Fonds excluent le mode 'banque' : sans ce filtre, `montantFond ||
// montantTotal` ferait retomber une depense bancaire (montantFond = 0) sur
// montantTotal et la compterait comme un retrait de fonds.
//
// Cout : une requete supplementaire, uniquement s il existe des lignes liees
// sur la periode, et seulement sur leurs identifiants distincts.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // P88

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee       = parseInt(searchParams.get('annee') ?? String(new Date().getFullYear()));
    const moisCourant = parseInt(searchParams.get('mois')  ?? String(new Date().getMonth() + 1));
    const userId      = session.user.id;

    // Bornes dates de l'annee
    const dateDebut = new Date(`${annee}-01-01`);
    const dateFin   = new Date(`${annee}-12-31T23:59:59`);

    // 1. anneeRec + categories en parallele
    //    NOTE : on ne retourne PAS d'erreur si anneeRec est null.
    //    Le budget sera vide mais les decStats doivent toujours etre calcules.
    const [anneeRec, categories] = await Promise.all([
      prisma.annee.findUnique({
        where: { userId_annee: { userId, annee } },
      }),
      prisma.categorie.findMany({
        where:   { userId, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
    ]);

    // 2. Budget + decaissements + mouvements en parallele
    //    Budget        : requete seulement si anneeRec existe
    //    Decaissements : par relation annee si anneeRec existe,
    //                    sinon par createdAt annee (fallback)
    //    Mouvements    : toujours par dateOperation (independant de anneeRec)
    const [budgetRows, decaissements, mouvements] = await Promise.all([

      anneeRec
        ? prisma.budgetMensuel.findMany({
            where:   { userId, anneeId: anneeRec.id },
            include: { categorie: true },
          })
        : Promise.resolve([] as any[]),

      prisma.decaissement.findMany({
        where: anneeRec
          // Filtre relationnel standard (acces direct via anneeId)
          ? { userId, annee: { annee } }
          // Fallback si pas d'anneeRec : par date de creation
          : { userId, createdAt: { gte: dateDebut, lte: dateFin } },
        select: {
          typeMouvement: true,
          mode:          true,
          montantFond:   true,
          montantBanque: true,
          montantTotal:  true,
        },
      }),

      prisma.mouvementBanque.findMany({
        where: {
          userId,
          dateOperation: { gte: dateDebut, lte: dateFin },
        },
        select: {
          typeMouvement:  true,
          montant:        true,
          dateOperation:  true,
          decaissementId: true,
        },
      }),
    ]);

    // 2-bis. S25-Q28 — quels decaissements lies existent encore ?
    const idsLies = Array.from(new Set(
      mouvements.map(m => m.decaissementId).filter((v): v is string => !!v),
    ));
    const decExistants = idsLies.length > 0
      ? await prisma.decaissement.findMany({
          where:  { userId, id: { in: idsLies } },
          select: { id: true },
        })
      : [];
    const setExistants = new Set(decExistants.map(d => d.id));
    const mouvementsRetenus = mouvements.filter(
      m => !m.decaissementId || setExistants.has(m.decaissementId),
    );

    // 3. Cumul budget par categorie (12 mois -> 1 ligne par categorie)
    const budgetCumul: Record<string, any> = {};
    for (const b of budgetRows) {
      if (!budgetCumul[b.categorieId]) {
        budgetCumul[b.categorieId] = {
          categorieId:     b.categorieId,
          categorie:       b.categorie,
          montantAnticipe: 0,
          montantReel:     0,
        };
      }
      budgetCumul[b.categorieId].montantAnticipe += Number(b.montantAnticipe ?? 0);
      budgetCumul[b.categorieId].montantReel     += Number(b.montantReel     ?? 0);
    }

    // 4. Historique 6 derniers mois (depenses uniquement)
    const MOIS_COURTS: Record<number, string> = {
      1:'Jan', 2:'Fev', 3:'Mar', 4:'Avr', 5:'Mai', 6:'Jun',
      7:'Jul', 8:'Aou', 9:'Sep', 10:'Oct', 11:'Nov', 12:'Dec',
    };
    const hist = [];
    for (let i = 5; i >= 0; i--) {
      let m = moisCourant - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      const rows = budgetRows.filter(b => b.mois === m);
      hist.push({
        mois: MOIS_COURTS[m],
        ant:  rows.filter(b => estSortie(b.categorie?.type)).reduce((s, b) => s + Number(b.montantAnticipe ?? 0), 0),
        reel: rows.filter(b => estSortie(b.categorie?.type)).reduce((s, b) => s + Number(b.montantReel     ?? 0), 0),
      });
    }

    // 5. Stats decaissements & mouvements banques (filtres par annee)
    //    Fonds  : mode 'banque' exclu (aucun fonds touche).
    //    Banque : journal seul, lignes orphelines ecartees (Q28).
    const decFonds       = decaissements.filter(d => d.mode !== 'banque');
    const fondAjouts     = decFonds.filter(d => d.typeMouvement === 'ajout').reduce((s, d) => s + Number(d.montantFond || d.montantTotal || 0), 0);
    const fondRetraits   = decFonds.filter(d => d.typeMouvement === 'retrait').reduce((s, d) => s + Number(d.montantFond || d.montantTotal || 0), 0);
    const banqueAjouts   = mouvementsRetenus.filter(m => m.typeMouvement === 'ajout').reduce((s, m) => s + Number(m.montant || 0), 0);
    const banqueRetraits = mouvementsRetenus.filter(m => m.typeMouvement === 'retrait').reduce((s, m) => s + Number(m.montant || 0), 0);

    return NextResponse.json(serial({
      budget:     Object.values(budgetCumul),
      categories,
      hist,
      decStats:   { fondAjouts, fondRetraits, banqueAjouts, banqueRetraits },
    }));
  } catch (e: any) {
    console.error('GET /api/dashboard/recap:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 }); // P113
  }
}
