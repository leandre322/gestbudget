import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { dechiffrerSecret, verifierCode, verifierCodeSecours, hacherJetonAppareil } from './totp';
import { verifierEtIncrementerLimite, reinitialiserLimite } from './rate-limit';
import { CODE_2FA_REQUIS, CODE_2FA_INVALIDE, CODE_LOGIN_LIMITE, CODE_2FA_LIMITE } from './auth-constants';

// =============================================================================
// S26 — 2FA TOTP + limiteur de debit sur la connexion.
//
// Le message d'une Error levee dans authorize() est transmis tel quel au
// client via signIn(..., {redirect:false}) -> result.error, en NextAuth v4
// UNIQUEMENT (v5 a change ce comportement — verifie avant d'ecrire ce fichier,
// a reconsiderer si le projet migre un jour vers v5). Les quatre codes
// distincts (lib/auth-constants.ts) permettent au formulaire de distinguer :
// mauvais mot de passe (return null -> 'CredentialsSignin' generique, comme
// avant), 2FA requis (reveler le champ code), code 2FA faux, et limite de
// debit atteinte — sans jamais confirmer ni infirmer l'existence d'un compte
// avant d'avoir verifie le mot de passe.
//
// LIMITEUR DE DEBIT (lib/rate-limit.ts) — complete le limiteur PAR IP de
// middleware.ts (voir l'en-tete de lib/rate-limit.ts). Deux compteurs
// distincts, par compte :
//   login:<email>   10 tentatives / 15 min — couvre le mot de passe
//   totp:<userId>    5 tentatives / 5 min  — couvre le code 2FA, plus strict
//                                            car le mot de passe est deja
//                                            connu correct a ce stade
// Cle par email (pas par IP) : deliberement, un attaquant qui ne connait pas
// le mot de passe ne doit pas pouvoir epuiser la limite d'un autre utilisateur
// juste en changeant d'IP. La contrepartie (verrou temporaire d'un compte
// connu par son email) est le compromis standard pour ce type de protection.
//
// APPAREIL DE CONFIANCE — authorize() ne peut pas POSER de cookie (pas
// d'acces a l'objet reponse dans NextAuth v4), seulement en LIRE un. L'ecriture
// se fait dans une route a part, POST /api/2fa/trust-device, appelee par le
// client juste apres un signIn() reussi si la case "se souvenir" est cochee.
//
// TOKENVERSION (S26, B2b) — un reset de mot de passe (app/api/reset-password)
// incremente users.tokenVersion. Le callback jwt() ci-dessous compare a
// chaque acces (poll client, getServerSession cote serveur) la valeur portee
// par le token avec la valeur courante en base ; une erreur levee ici est le
// mecanisme NextAuth v4 documente pour signaler une session invalide — 
// getServerSession() et /api/auth/session renvoient "non connecte" sans
// jamais faire planter l'appelant. middleware.ts fait une verification
// equivalente pour les pages protegees (getToken() ne repasse jamais par ce
// callback, voir l'en-tete de middleware.ts).
// =============================================================================

const NOM_COOKIE_APPAREIL = 'gb_trusted_device';

/**
 * Lit un cookie depuis l'en-tete brut. Le `req` que NextAuth v4 passe a
 * authorize() n'est pas un NextRequest complet : selon le contexte d'appel,
 * `req.headers` peut etre soit un objet simple (`headers.cookie`), soit une
 * instance Headers (`headers.get('cookie')`). Les deux formes sont couvertes.
 */
function lireCookieBrut(req: any, nom: string): string | undefined {
  const headers = req?.headers;
  if (!headers) return undefined;
  const brut: string | undefined =
    typeof headers.get === 'function' ? (headers.get('cookie') ?? undefined) : headers.cookie;
  if (!brut) return undefined;
  const motif = new RegExp(`(?:^|;\\s*)${nom}=([^;]+)`);
  const match = brut.match(motif);
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function estAppareilDeConfiance(req: any, userId: string): Promise<boolean> {
  const jetonClair = lireCookieBrut(req, NOM_COOKIE_APPAREIL);
  if (!jetonClair) return false;

  const jetonHash = hacherJetonAppareil(jetonClair);
  const appareil = await prisma.trustedDevice.findUnique({ where: { tokenHash: jetonHash } });

  if (!appareil || appareil.userId !== userId) return false;
  if (appareil.expiresAt < new Date()) return false;

  // Best-effort : la mise a jour de lastUsedAt ne doit jamais bloquer une
  // connexion, meme si elle echoue (contention, latence Neon).
  prisma.trustedDevice
    .update({ where: { id: appareil.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return true;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',        type: 'email'    },
        password: { label: 'Mot de passe', type: 'password' },
        code:     { label: 'Code 2FA',     type: 'text'     },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase();

        // ── Limite sur la connexion elle-meme ────────────────────────────
        // Avant meme de savoir si le compte existe : un email inconnu ne
        // doit pas beneficier d'un chemin plus rapide qu'un email connu,
        // ce qui creerait un canal d'enumeration de comptes par le timing.
        const limiteLogin = await verifierEtIncrementerLimite(prisma, `login:${email}`, 10, 15 * 60);
        if (!limiteLogin.autorise) {
          throw new Error(CODE_LOGIN_LIMITE);
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const motDePasseValide = await bcrypt.compare(credentials.password, user.password);
        if (!motDePasseValide) return null;

        // Mot de passe correct : le compteur de connexion ne doit plus
        // penaliser cet utilisateur pour ses essais precedents.
        await reinitialiserLimite(prisma, `login:${email}`);

        // ── 2FA ───────────────────────────────────────────────────────────
        if (user.totpActive && user.totpSecret) {
          const appareilFiable = await estAppareilDeConfiance(req, user.id);

          if (!appareilFiable) {
            const code = credentials.code?.trim();
            if (!code) {
              throw new Error(CODE_2FA_REQUIS);
            }

            const limiteTotp = await verifierEtIncrementerLimite(prisma, `totp:${user.id}`, 5, 5 * 60);
            if (!limiteTotp.autorise) {
              throw new Error(CODE_2FA_LIMITE);
            }

            let codeValide = false;

            if (/^\d{6}$/.test(code)) {
              const secretClair = dechiffrerSecret(user.totpSecret);
              codeValide = verifierCode(secretClair, code);
            } else {
              // Format code de secours (XXXX-XXXX). Boucle sur les codes non
              // utilises : voir lib/totp.ts pour le raisonnement sur le cout.
              const codesSecours = await prisma.backupCode.findMany({
                where: { userId: user.id, usedAt: null },
              });
              for (const bc of codesSecours) {
                if (await verifierCodeSecours(code, bc.codeHash)) {
                  codeValide = true;
                  await prisma.backupCode.update({
                    where: { id: bc.id },
                    data:  { usedAt: new Date() },
                  });
                  break;
                }
              }
            }

            if (!codeValide) {
              throw new Error(CODE_2FA_INVALIDE);
            }

            await reinitialiserLimite(prisma, `totp:${user.id}`);
          }
        }

        return {
          id:           user.id,
          email:        user.email,
          name:         user.nom ?? user.email,
          tokenVersion: user.tokenVersion,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tokenVersion = user.tokenVersion;
        // Horodatage de connexion initiale (pour audit futur et verification serveur)
        token.loginAt = Math.floor(Date.now() / 1000);
        return token;
      }

      // S26 (B2b) — reverifie a chaque acces (poll client, getServerSession
      // cote serveur) que le compteur n'a pas ete incremente entre-temps par
      // un reset-password. A verifier manuellement une fois deploye (test
      // decrit dans le recap de session) avant de considerer B2 clos.
      if (token?.id) {
        const dbUser = await prisma.user.findUnique({
          where:  { id: token.id as string },
          select: { tokenVersion: true },
        });
        if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
          throw new Error('SessionRevoquee');
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id      = token.id as string;
        session.user.loginAt = token.loginAt as number;
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
    error:  '/login',
  },

  session: {
    strategy: 'jwt',

    // SECURITE — etait 30 * 24 * 60 * 60 (30 jours) : n'importe qui avec le
    // cookie avait 30 jours d'acces meme si le client avait expire la session.
    // 24h = maximum absolu cote serveur.
    maxAge: 24 * 60 * 60,

    // Renouvelle automatiquement le token JWT si l'utilisateur est actif.
    // Le token est prolonge de maxAge (24h) a partir du dernier appel API,
    // tant que l'activite reste reguliere.
    // Sans updateAge, le token expirerait exactement 24h apres la connexion
    // meme si l'utilisateur utilisait l'app.
    updateAge: 30 * 60,
  },

  secret: process.env.NEXTAUTH_SECRET,
};

// ─── Extensions de types ──────────────────────────────────────────────────────

declare module 'next-auth' {
  interface Session {
    user: {
      id:       string;
      email:    string;
      name?:    string | null;
      loginAt?: number;
    };
  }
  interface User {
    tokenVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id:            string;
    loginAt?:      number;
    tokenVersion?: number;
  }
}