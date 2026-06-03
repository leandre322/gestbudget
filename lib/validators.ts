import { z } from 'zod';

export const DecaissementSchema = z.object({
  impacterBanque: z.boolean().optional(),
  description:   z.string().min(1,'Description requise').max(200).trim(),
  dateOperation: z.string().refine(v => !isNaN(Date.parse(v)), 'Date invalide'),
  montantFond:   z.number().min(0).max(999_999_999).optional().default(0),
  montantBanque: z.number().min(0).max(999_999_999).optional().default(0),
  banqueId:      z.string().optional(),
  compteId:      z.string().optional(),
  notes:         z.string().max(500).optional(),
  typeMouvement: z.enum(['retrait','ajout']).default('retrait'),
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