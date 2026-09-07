import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BanqueCreateSchema, BanqueUpdateSchema } from '@/lib/validators';

// ─────────────────────────────────────────────────────────────────────────────
// S12 — refonte complete de la route. Rappel des defauts corriges :
//
//  P8  Les schemas Zod etaient importes mais jamais appeles. Le body etait
//      parse brut, donc montant:"abc" atteignait BigInt(Math.round(NaN)) et
//      sortait en RangeError -> 500.
//  P13 PUT et DELETE n'appelaient pas csrfCheck. Seul POST le faisait, alors
//      que ce sont eux qui modifient un solde et suppriment un compte.
//  P15 Les 500 renvoyaient e.message : messages Prisma bruts (noms de
//      colonnes, contraintes) exposes au client.
//  P16 findFirst controlait le userId, puis update({where:{id}}) ne le
//      portait plus.
//  P17 logAudit n'envoyait ni entityNom ni details : lignes inexploitables.
//  P9  DELETE etait une suppression dure, cascade sur mouvements_banque.
//
// Q14 mode B — journalisation transactionnelle
//   Toute variation de banques.solde passee par ce PUT ecrit AUSSI une ligne
//   mouvements_banque, dans la MEME transaction. C'etait le troisieme chemin
//   d'ecriture non journalise (constat S11 : 435 000 sur BOA-CmpteEpargneLeo).
//   Cible A : ce PUT perdra toute capacite d'ecriture sur solde une fois le
//   Dashboard bascule sur /api/banques/mouvements.
//
//   Convention alignee sur /api/banques/mouvements (ne PAS diverger) :
//     increment          -> typeMouvement 'ajout',   montant = mt
//     decrement          -> typeMouvement 'retrait', montant = mt
//     set / solde direct -> typeMouvement 'set',     montant = |cible - avant|
//   Delta nul = aucun mouvement ecrit (pas de bruit dans l'historique).
//
// Q24 decrement : rejet 422 si le solde deviendrait negatif, au lieu de
//   l'ancien clamp silencieux a 0. Un clamp aurait journalise un montant
//   different de celui demande — precisement l'ecart qu'on cherche a fermer.
// ─────────────────────────────────────────────────────────────────────────────

const MOTIF_DEFAUT = 'Ajustement direct - PUT /api/banques';
const fmt = (v: bigint) => Number(v).toLocaleString('fr-FR');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/banques?includeInactive=1
// Q15 : le soft delete impose un filtre isActive, sinon une banque desactivee
// resterait affichee dans Parametres, le Dashboard et le calcul du patrimoine.
// P23 : tri stable (ordre, puis id) — l'ancien orderBy updatedAt rendait
// l'ordre dependant de la derniere modification.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const inclureInactives =
      new URL(req.url).searchParams.get('includeInactive') === '1';

    const banques = await prisma.banque.findMany({
      where: {
        userId: session.user.id,
        ...(inclureInactives ? {} : { isActive: true }),
      },
      orderBy: [{ ordre: 'asc' }, { id: 'asc' }],
    });

    return NextResponse.json(serial({ banques }));
  } catch (e: any) {
    console.error('GET /api/banques:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/banques
// Le solde initial n'ecrit PAS de mouvement : c'est l'etat de depart du
// compte, pas une operation. soldeAvant serait fictif.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = validateBody(BanqueCreateSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { nomBanque, typeCompte, soldeInitial, ordre, seuilAlerte, compteUrgence } = parsed.data;

    const banque = await prisma.banque.create({
      data: {
        userId:        session.user.id,
        nomBanque,
        typeCompte:    typeCompte ?? null,
        solde:         BigInt(soldeInitial),
        ordre,
        seuilAlerte:   BigInt(seuilAlerte),
        compteUrgence,
      },
    });

    await logAudit({
      userId:     session.user.id,
      action:     'create',
      entityType: 'banque',
      entityId:   banque.id,
      entityNom:  banque.nomBanque,
      details:    { soldeInitial, seuilAlerte, compteUrgence, typeCompte: typeCompte ?? null },
      req,
    });

    return NextResponse.json(serial({ success: true, banque }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/banques:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/banques?id=xxx
// Body :
//   { nomBanque, typeCompte, ordre, isActive, seuilAlerte }  metadonnees
//   { compteUrgence: boolean }                               perimetre F12
//   { action:'set'|'increment'|'decrement', montant }        solde + mouvement
//   { solde: number }                                        alias de set
//   { motif?: string }                                       reporte au mouvement
// ─────────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);   // P13
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id)
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = validateBody(BanqueUpdateSchema, rawBody);   // P8
    if (parsed.error) return parsed.error;
    const {
      nomBanque, typeCompte, seuilAlerte, isActive, ordre,
      compteUrgence, action, montant, solde: soldeDirect, motif,
    } = parsed.data;

    let resultat: any;

    try {
      resultat = await prisma.$transaction(async (tx) => {
        const existing = await tx.banque.findFirst({
          where:  { id, userId: session.user.id },
          select: { id: true, solde: true, nomBanque: true, compteUrgence: true },
        });
        if (!existing)
          throw Object.assign(new Error('NOT_FOUND'), { code: 404 });

        const updateData: any = {};
        const champsModifies: Record<string, any> = {};

        if (nomBanque     !== undefined) { updateData.nomBanque     = nomBanque;              champsModifies.nomBanque     = nomBanque; }
        if (typeCompte    !== undefined) { updateData.typeCompte    = typeCompte ?? null;     champsModifies.typeCompte    = typeCompte ?? null; }
        if (ordre         !== undefined) { updateData.ordre         = ordre;                  champsModifies.ordre         = ordre; }
        if (isActive      !== undefined) { updateData.isActive      = isActive;               champsModifies.isActive      = isActive; }
        if (seuilAlerte   !== undefined) { updateData.seuilAlerte   = BigInt(seuilAlerte);    champsModifies.seuilAlerte   = seuilAlerte; }

        // Q16 : le flag est editable depuis le Dashboard. Il deplace un compte
        // dans ou hors du perimetre du fonds d'urgence, donc hors du
        // denominateur du score. On journalise l'ancienne valeur.
        if (compteUrgence !== undefined) {
          updateData.compteUrgence = compteUrgence;
          champsModifies.compteUrgence = { avant: existing.compteUrgence, apres: compteUrgence };
        }

        // ── Solde ────────────────────────────────────────────────────────
        const soldeAvant = BigInt(Number(existing.solde ?? 0));
        let soldeApres:    bigint | null = null;
        let typeMouvement: 'ajout' | 'retrait' | 'set' | null = null;

        if (action === 'increment') {
          soldeApres    = soldeAvant + BigInt(montant ?? 0);
          typeMouvement = 'ajout';
        } else if (action === 'decrement') {
          const dec = BigInt(montant ?? 0);
          if (soldeAvant < dec) {
            throw Object.assign(new Error('SOLDE_INSUFFISANT'), {
              code: 422,
              details: `${existing.nomBanque} : disponible ${fmt(soldeAvant)} FCFA, demande ${fmt(dec)} FCFA. Le solde d'un compte bancaire ne peut pas etre negatif.`,
            });
          }
          soldeApres    = soldeAvant - dec;
          typeMouvement = 'retrait';
        } else if (action === 'set') {
          soldeApres    = BigInt(montant ?? 0);
          typeMouvement = 'set';
        } else if (soldeDirect !== undefined) {
          soldeApres    = BigInt(soldeDirect);
          typeMouvement = 'set';
        }

        let mouvementId: string | null = null;

        if (soldeApres !== null && soldeApres !== soldeAvant) {
          updateData.solde = soldeApres;

          const montantLog =
            typeMouvement === 'set'
              ? (soldeApres > soldeAvant ? soldeApres - soldeAvant : soldeAvant - soldeApres)
              : BigInt(montant ?? 0);

          // Q14 mode B — le mouvement nait dans la meme transaction que
          // l'ecriture du solde. Ni l'un ni l'autre ne peut exister seul.
          const mvt = await tx.mouvementBanque.create({
            data: {
              userId:        session.user.id,
              banqueId:      id,
              typeMouvement: typeMouvement as string,
              montant:       montantLog,
              soldeAvant,
              soldeApres,
              // Q21 : motif par defaut. Le modal du Dashboard n'en envoie pas,
              // et BanqueMouvementSchema en exige un pour 'set'. L'origine
              // reste identifiable dans l'historique.
              motif:         motif?.trim() || MOTIF_DEFAUT,
              dateOperation: new Date(),
            },
          });
          mouvementId = mvt.id;
          champsModifies.solde = { avant: Number(soldeAvant), apres: Number(soldeApres) };
        }

        if (Object.keys(updateData).length === 0) {
          // Le superRefine bloque deja le PUT vide, mais un PUT qui ne
          // contient qu'un solde egal a l'existant arrive jusqu'ici.
          return { banque: existing, mouvementId: null, champsModifies };
        }

        const banque = await tx.banque.update({
          where: { id, userId: session.user.id },   // P16
          data:  updateData,
        });

        return { banque, mouvementId, champsModifies };
      });
    } catch (txErr: any) {
      if (txErr.message === 'NOT_FOUND')
        return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
      if (txErr.message === 'SOLDE_INSUFFISANT')
        return NextResponse.json({ error: txErr.details }, { status: 422 });
      throw txErr;
    }

    // P17 : entityNom et details renseignes. Sans eux, les lignes d'audit
    // etaient inexploitables pour la reconciliation P10.
    await logAudit({
      userId:     session.user.id,
      action:     'update',
      entityType: 'banque',
      entityId:   id,
      entityNom:  resultat.banque.nomBanque,
      details:    { ...resultat.champsModifies, mouvementId: resultat.mouvementId },
      req,
    });

    return NextResponse.json(serial({
      success:     true,
      banque:      resultat.banque,
      mouvementId: resultat.mouvementId,
    }));
  } catch (e: any) {
    console.error('PUT /api/banques:', e?.message, e?.stack);   // P15
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/banques?id=xxx[&force=1][&detach=1]   — Q15 / P9
//
// SOFT DELETE. L'ancienne version faisait un DELETE dur : la cascade emportait
// tous les mouvements_banque du compte, donc l'historique servant a la
// reconciliation P10. Desormais isActive = false, les lignes restent.
//
// Blocages (409) leves explicitement par l'appelant :
//   solde != 0             -> ?force=1   le montant sort du patrimoine
//   CompteFonds rattache   -> ?detach=1  Yvan/Naelle perdraient leur support
//   Categorie rattachee    -> ?detach=1  epargne_investissement pointe dessus
//
// Les FK ne protegent pas ici : onDelete SetNull ne se declenche que sur une
// suppression reelle, jamais sur un passage a isActive=false.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);   // P13
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const url    = new URL(req.url);
    const id     = url.searchParams.get('id');
    const force  = url.searchParams.get('force')  === '1';
    const detach = url.searchParams.get('detach') === '1';
    if (!id)
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const banque = await prisma.banque.findFirst({
      where:  { id, userId: session.user.id },
      select: {
        id: true, nomBanque: true, solde: true, isActive: true,
        compteFonds: { select: { id: true, nom: true } },
        categories:  { select: { id: true, nom: true } },
      },
    });
    if (!banque)
      return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });

    if (!banque.isActive)
      return NextResponse.json({ success: true, deja: true });

    const soldeNum = Number(banque.solde ?? 0);
    const blocages: any = {};

    if (soldeNum !== 0 && !force)      blocages.solde      = soldeNum;
    if (banque.compteFonds.length && !detach) blocages.fonds = banque.compteFonds.map(c => c.nom).join(', ');
    if (banque.categories.length && !detach)
      blocages.categories = banque.categories.map(c => c.nom);

    if (Object.keys(blocages).length > 0) {
      const raisons: string[] = [];
      if (blocages.solde !== undefined)
        raisons.push(`solde non nul (${fmt(BigInt(soldeNum))} FCFA) — relancez avec force=1`);
      if (blocages.fonds)
        raisons.push(`heberge le fonds "${blocages.fonds}" — relancez avec detach=1`);
      if (blocages.categories)
        raisons.push(`referencee par ${blocages.categories.length} categorie(s) — relancez avec detach=1`);
      return NextResponse.json({
        error: `${banque.nomBanque} ne peut pas etre desactivee : ${raisons.join(' ; ')}.`,
        blocages,
      }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      if (detach && banque.compteFonds.length > 0) {
        await tx.compteFonds.updateMany({
          where: { banqueId: id, userId: session.user.id },
          data:  { banqueId: null },
        });
      }
      if (detach && banque.categories.length > 0) {
        await tx.categorie.updateMany({
          where: { banqueId: id, userId: session.user.id },
          data:  { banqueId: null },
        });
      }
      await tx.banque.update({
        where: { id, userId: session.user.id },   // P16
        data:  { isActive: false },
      });
    });

    await logAudit({
      userId:     session.user.id,
      action:     'delete',
      entityType: 'banque',
      entityId:   id,
      entityNom:  banque.nomBanque,
      details: {
        soft:              true,
        soldeAuMomentDeLaDesactivation: soldeNum,
        force,
        detach,
        fondsDetache:      detach ? banque.compteFonds.map(c => c.nom) : [],
        categoriesDetachees: detach ? banque.categories.map(c => c.nom) : [],
      },
      req,
    });

    return NextResponse.json({ success: true, soft: true });
  } catch (e: any) {
    console.error('DELETE /api/banques:', e?.message, e?.stack);   // P15
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}