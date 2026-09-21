// =============================================================================
// lib/auth-constants.ts  --  Codes d'erreur 2FA (S26)
// =============================================================================
// Fichier volontairement sans AUCUNE dependance (ni prisma, ni bcrypt, ni
// next-auth). lib/auth.ts (serveur) les leve via throw new Error(CODE_...) ;
// login/page.tsx ('use client') les importe directement pour distinguer les
// cas sans jamais tirer de code serveur dans le bundle client.
//
// Le message d'une Error levee dans authorize() est transmis tel quel au
// client par NextAuth v4 (result.error, avec signIn(..., {redirect:false})).
// Comportement specifique a v4 -- verifie avant d'ecrire ce module.
// =============================================================================

/** Identifiants et mot de passe corrects, mais 2FA actif : code requis. */
export const CODE_2FA_REQUIS = '2FA_REQUIRED';

/** Code TOTP ou de secours soumis, mais invalide. */
export const CODE_2FA_INVALIDE = '2FA_INVALID';

/** Trop de tentatives de connexion (email + mot de passe) recemment. */
export const CODE_LOGIN_LIMITE = 'LOGIN_RATE_LIMITED';

/** Trop de tentatives de code 2FA recemment. */
export const CODE_2FA_LIMITE = '2FA_RATE_LIMITED';
