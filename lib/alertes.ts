import prisma from '@/lib/prisma';
import { sendPushToUser } from '@/lib/push';

const SEUILS = [80, 100] as const;
const SEPT_JOURS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Vérifie les seuils budgétaires (80% / 100%) d'une catégorie après mutation
 * de montantReel, et envoie une push si un seuil est franchi.
 * - Garde-fou : aucune alerte si montantAnticipe = 0 (budget non défini)
 * - Anti-spam : 1 notif max par seuil par semaine (ligne unique + sentAt)
 * - Ne s'applique qu'aux catégories de type depense_*
 */
export async function verifierSeuilsBudget(params: {
  userId: string;
  anneeId: string;
  categorieId: string;
  mois: number;
}): Promise<void> {
  const { userId, anneeId, categorieId, mois } = params;

  try {
    const [ligne, categorie] = await Promise.all([
      prisma.budgetMensuel.findUnique({
        where: { userId_anneeId_categorieId_mois: { userId, anneeId, categorieId, mois } },
      }),
      prisma.categorie.findUnique({ where: { id: categorieId } }),
    ]);

    if (!ligne || !categorie) return;
    if (!categorie.type.startsWith('depense')) return;

    const anticipe = Number(ligne.montantAnticipe);
    const reel = Number(ligne.montantReel);
    if (anticipe <= 0) return; // garde-fou : budget non défini → jamais d'alerte

    const pct = Math.round((reel / anticipe) * 100);

    for (const seuil of SEUILS) {
      if (pct < seuil) continue;

      const key = { userId, categorieId, anneeId, mois, seuil };
      const existante = await prisma.budgetAlerte.findUnique({
        where: { userId_categorieId_anneeId_mois_seuil: key },
      });

      // Anti-spam : déjà envoyée il y a moins de 7 jours → skip
      if (existante && Date.now() - existante.sentAt.getTime() < SEPT_JOURS_MS) continue;

      if (existante) {
        await prisma.budgetAlerte.update({
          where: { userId_categorieId_anneeId_mois_seuil: key },
          data: { sentAt: new Date() },
        });
      } else {
        // create protégé : si course avec un autre appel, la contrainte unique tranche
        await prisma.budgetAlerte.create({ data: key }).catch(() => { return null; });
      }

      const msg = seuil === 100
        ? `Budget "${categorie.nom}" depasse : ${pct}% utilise ce mois`
        : `Budget "${categorie.nom}" : ${pct}% utilise ce mois`;

      await sendPushToUser(userId, {
        title: seuil === 100 ? 'GestBudget — Budget depasse' : 'GestBudget — Alerte budget',
        body: msg,
        url: '/suivi',
        tag: `budget-${categorieId}-${seuil}`, // remplace la notif précédente du même seuil
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[verifierSeuilsBudget]', e); // jamais bloquant pour la mutation appelante
  }
}