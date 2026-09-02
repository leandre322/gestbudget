import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Decaissement — S7 FIX
//   1. banqueId / compteId / notes en .nullish() : le front envoie `null`
//      explicitement, et .optional() n'accepte QUE `undefined` (bug Zod 4).
//   2. `mode` explicite ('fond' | 'transfert') : le serveur ne DEDUIT plus
//      l'intention a partir de la presence des champs.
//   3. superRefine : coherence mode / banqueId / montants.
// ─────────────────────────────────────────────────────────────────────────────
export const DecaissementSchema = z.object({
  mode:           z.enum(['fond', 'transfert']).default('fond'),
  impacterBanque: z.boolean().nullish(),
  description:    z.string().min(1, 'Description requise').max(200).trim(),
  dateOperation:  z.string().refine(v => !isNaN(Date.parse(v)), 'Date invalide'),
  montantFond:    z.number().min(0).max(999_999_999).optional().default(0),
  montantBanque:  z.number().min(0).max(999_999_999).optional().default(0),
  banqueId:       z.string().min(1).nullish(),
  compteId:       z.string().min(1).nullish(),
  notes:          z.string().max(500).nullish(),
  typeMouvement:  z.enum(['retrait', 'ajout']).default('retrait'),
  sourceVocale:   z.boolean().optional().default(false), // D1 — dictee vocale
}).superRefine((v, ctx) => {
  // Commun aux deux modes : un fond et un montant fond sont obligatoires
  if (!v.compteId) {
    ctx.addIssue({ code: 'custom', path: ['compteId'], message: 'Selectionnez un fond' });
  }
  if (!v.montantFond || v.montantFond <= 0) {
    ctx.addIssue({ code: 'custom', path: ['montantFond'], message: 'Montant du fond obligatoire' });
  }

  // Mode « Fond seul » : aucune banque ne doit etre impliquee
  if (v.mode === 'fond') {
    if (v.banqueId) {
      ctx.addIssue({ code: 'custom', path: ['banqueId'], message: 'Aucune banque attendue en mode Fond seul' });
    }
    if (v.montantBanque && v.montantBanque > 0) {
      ctx.addIssue({ code: 'custom', path: ['montantBanque'], message: 'Aucun montant banque attendu en mode Fond seul' });
    }
  }

  // Mode « Fond + Banque » : banque ET montant banque obligatoires
  if (v.mode === 'transfert') {
    if (!v.banqueId) {
      ctx.addIssue({ code: 'custom', path: ['banqueId'], message: 'Selectionnez une banque' });
    }
    if (!v.montantBanque || v.montantBanque <= 0) {
      ctx.addIssue({ code: 'custom', path: ['montantBanque'], message: 'Montant banque obligatoire pour un transfert' });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mouvement bancaire (mode « Banque seule ») — S7 NOUVEAU
// Cette route parsait le body brut : `motif` sans limite de taille,
// `dateOperation` non validee (Invalid Date envoye a Prisma), banqueId non type.
// ─────────────────────────────────────────────────────────────────────────────
export const BanqueMouvementSchema = z.object({
  banqueId:      z.string().min(1, 'Compte bancaire obligatoire'),
  typeMouvement: z.enum(['ajout', 'retrait', 'set']),
  montant:       z.number().min(0).max(9_999_999_999).optional().default(0),
  motif:         z.string().max(500).nullish(),
  dateOperation: z.string().refine(v => !isNaN(Date.parse(v)), 'Date invalide').nullish(),
}).superRefine((v, ctx) => {
  if (v.typeMouvement !== 'set' && (!v.montant || v.montant <= 0)) {
    ctx.addIssue({ code: 'custom', path: ['montant'], message: 'Montant obligatoire' });
  }
  if (v.typeMouvement === 'set' && !v.motif?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['motif'], message: 'Le motif est obligatoire pour une correction de solde' });
  }
});

export const CompteFondsUpdateSchema = z.object({
  nom:         z.string().min(1).max(100).trim().optional(),
  ordre:       z.number().int().min(0).max(100).optional(),
  isActive:    z.boolean().optional(),
  objectif:    z.number().min(0).max(9_999_999_999).optional(),
  seuilAlerte: z.number().min(0).max(9_999_999_999).optional(),
  action:      z.enum(['increment','decrement','set']).optional(),
  montant:     z.number().min(0).max(9_999_999_999).optional(),
});

export const BanqueUpdateSchema = z.object({
  nomBanque:   z.string().min(1).max(100).trim().optional(),
  typeCompte:  z.string().max(50).optional(),
  seuilAlerte: z.number().min(0).max(9_999_999_999).optional(),
  isActive:    z.boolean().optional(),
  ordre:       z.number().int().min(0).max(100).optional(),
});

export const PushSendSchema = z.object({
  title: z.string().min(1).max(100),
  body:  z.string().min(1).max(200),
  url:   z.string().optional(),
  tag:   z.string().max(50).optional(),
});

export const RegisterSchema = z.object({
  email:    z.string().email('Email invalide').toLowerCase().trim(),
  password: z.string().min(8,'Minimum 8 caracteres')
              .regex(/[A-Z]/,'Une majuscule requise')
              .regex(/[0-9]/,'Un chiffre requis'),
  nom:      z.string().min(1).max(100).trim().optional(),
});

export const BanqueCreateSchema = z.object({
  nomBanque:    z.string().min(1).max(100).trim().optional(),
  typeCompte:   z.string().max(50).optional(),
  soldeInitial: z.number().min(0).max(9_999_999_999).optional().default(0),
  ordre:        z.number().int().min(0).max(100).optional().default(0),
});

export const ParametresSchema = z.object({
  revenuMensuelReference: z.number().min(0).max(9_999_999_999).optional(),
  nMoisUrgence:           z.number().int().min(1).max(60).optional(),
  tauxReference:          z.record(z.string(), z.number().min(0).max(100)).optional(),
  rapportEmailActif:      z.boolean().optional(),
  rapportEmailJour:       z.number().int().min(1).max(28).optional(),
  rapportEmailHeure:      z.number().int().min(0).max(23).optional(),
  seuilAnomaliesPct:      z.number().int().min(10).max(200).optional(),
  langueVocale:           z.string().max(10).optional(), // D1 — dictee vocale
});

export const BudgetPutSchema = z.object({
  anneeId: z.string().min(1),
  mois:    z.number().int().min(1).max(12),
  lignes:  z.record(z.string(), z.object({
    anticipe: z.string().or(z.number()),
    reel:     z.string().or(z.number()),
  })),
});

export const BudgetPostSchema = z.object({
  anneeId:         z.string().min(1),
  categorieId:     z.string().min(1),
  mois:            z.number().int().min(1).max(12),
  montantAnticipe: z.number().min(0).max(9_999_999_999).optional(),
  montantReel:     z.number().min(0).max(9_999_999_999).optional(),
  notes:           z.string().max(500).optional(),
});
