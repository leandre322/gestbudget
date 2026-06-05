import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from './prisma';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',        type: 'email'    },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        return {
          id:    user.id,
          email: user.email,
          name:  user.nom ?? user.email,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // Horodatage de connexion initiale (pour audit futur et verification serveur)
        token.loginAt = Math.floor(Date.now() / 1000);
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
      loginAt?: number;          // Timestamp Unix de connexion initiale
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id:       string;
    loginAt?: number;
  }
}
