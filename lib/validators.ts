import { z } from 'zod';

export const DecaissementSchema = z.object({
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