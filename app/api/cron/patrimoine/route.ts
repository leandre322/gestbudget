import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// =============================================================================
//  S7 / F8 — Capture quotidienne du patrimoine
//  GET /api/cron/patrimoine  (Vercel Cron, authentifié par CRON_SECRET)
//
//  Écrit une ligne par compte (fonds + banque) et par date dans
//  patrimoine_snapshots. L'unicité (userId, dateSnapshot, typeSource, sourceId)
//  rend l'exécution idempotente : rejouer le job le même jour met à jour la
//  valeur au lieu de dupliquer.
//
//  ⚠️ Sécurité — cette route est sous /api/cron/*, préfixe EXEMPTÉ de CSRF dans
//  middleware.ts. Elle doit rester en GET et strictement lue par le cron. Un
//  éventuel bouton « Capturer maintenant » côté UI devra vivre dans une route
//  HORS /api/cron (par exemple /api/patrimoine/capture), sinon il contournerait
//  la protection CSRF.
//
//  Fréquence recommandée : quotidienne. Volumétrie ~10 lignes/jour/utilisateur,
//  soit environ 3 650 lignes par an — négligeable, et la courbe devient lisible
//  en quelques semaines au lieu de quelques mois.
// =============================================================================

export const dynamic = 'force-dynamic';

// Bénin : UTC+1 fixe, pas d'heure d'été.
// S7 / B7 : `new Date().toISOString().split('T')[0]` renvoie la date UTC et
// produit la VEILLE entre 00h et 01h heure locale. On décale avant de tronquer.
const DECALAGE_MINUTES = 60;

function dateLocaleDuJour(): Date {
  const maintenant = new Date();
  const local = new Date(maintenant.getTime() + DECALAGE_MINUTES * 60 * 1000);
  // Minuit UTC de la date locale — cohérent avec une colonne @db.Date
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

export async function GET(req: NextRequest) {
  const debut = Date.now();
  let statut  = 'success';
  let details = '';

  try {
    // ── Authentification cron ────────────────────────────────────────────
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error('[cron/patrimoine] CRON_SECRET absent — refus par défaut');
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const entete = req.headers.get('authorization') ?? '';
    if (entete !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const dateSnapshot = dateLocaleDuJour();

    // ── Comptes à capturer ───────────────────────────────────────────────
    // isActive: true uniquement — un compte clôturé ne doit plus alimenter la
    // courbe. Ses captures passées restent en base.
    const [comptes, banques] = await Promise.all([
      prisma.compteFonds.findMany({
        where:  { isActive: true },
        select: { id: true, userId: true, nom: true, soldeActuel: true },
      }),
      prisma.banque.findMany({
        where:  { isActive: true },
        select: { id: true, userId: true, nomBanque: true, solde: true },
      }),
    ]);

    type Capture = {
      userId: string;
      typeSource: string;
      sourceId: string;
      sourceNom: string;
      solde: bigint;
    };

    const captures: Capture[] = [
      ...comptes.map(c => ({
        userId:     c.userId,
        typeSource: 'fonds',
        sourceId:   c.id,
        sourceNom:  c.nom,
        solde:      c.soldeActuel,
      })),
      ...banques.map(b => ({
        userId:     b.userId,
        typeSource: 'banque',
        sourceId:   b.id,
        sourceNom:  b.nomBanque,
        solde:      b.solde,
      })),
    ];

    // ── Écriture idempotente ─────────────────────────────────────────────
    // upsert plutôt que createMany({ skipDuplicates }) : si le job est rejoué
    // dans la journée, on veut le solde le PLUS RÉCENT, pas le premier capturé.
    let ecrits = 0;
    let erreurs = 0;

    for (const c of captures) {
      try {
        await prisma.patrimoineSnapshot.upsert({
          where: {
            userId_dateSnapshot_typeSource_sourceId: {
              userId:       c.userId,
              dateSnapshot,
              typeSource:   c.typeSource,
              sourceId:     c.sourceId,
            },
          },
          create: {
            userId:     c.userId,
            dateSnapshot,
            typeSource: c.typeSource,
            sourceId:   c.sourceId,
            sourceNom:  c.sourceNom,
            solde:      c.solde,
          },
          update: {
            sourceNom: c.sourceNom,   // suit un renommage de compte
            solde:     c.solde,
          },
        });
        ecrits++;
      } catch (e) {
        // Une capture en échec ne doit pas faire tomber tout le job
        erreurs++;
        console.error('[cron/patrimoine] capture échouée:', c.typeSource, c.sourceId, e);
      }
    }

    if (erreurs > 0) statut = 'partial';
    details = `${ecrits}/${captures.length} captures — ${comptes.length} fonds, ${banques.length} banques`;

    return NextResponse.json({
      ok: true,
      date: dateSnapshot.toISOString().slice(0, 10),
      captures: ecrits,
      erreurs,
      fonds: comptes.length,
      banques: banques.length,
    });

  } catch (e) {
    statut  = 'error';
    details = 'Erreur inattendue';
    console.error('[cron/patrimoine] GET:', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });

  } finally {
    // Journalisation best-effort — ne doit jamais masquer l'erreur d'origine
    try {
      await prisma.cronLog.create({
        data: {
          jobName:    'patrimoine',
          status:     statut,
          durationMs: Date.now() - debut,
          details:    details || null,
        },
      });
    } catch (e) {
      console.error('[cron/patrimoine] CronLog:', e);
    }
  }
}
