import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export type AuditAction =
  | 'login' | 'logout' | 'register'
  | 'unlock' | 'lock'
  | 'create' | 'update' | 'delete'
  | 'export' | 'import'
  | 'push_subscribe' | 'push_unsubscribe';

export async function logAudit(params: {
  userId:     string;
  action:     AuditAction;
  entityType?: string;
  entityId?:   string;
  entityNom?:  string;
  details?:    Record<string, any>;
  req:         NextRequest;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId:     params.userId,
        action:     params.action,
        entityType: params.entityType,
        entityId:   params.entityId,
        entityNom:  params.entityNom,
        details:    params.details ?? undefined,
        ipAddress:  (params.req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim(),
      },
    });
  } catch (e) {
    // P156 (S24) — le catch vide masquait tout echec d ecriture d audit :
    // meme defaut que celui corrige par P142 sur la route donnees, ici loge
    // dans le fichier lui-meme plutot que dans un appelant. logAudit reste
    // volontairement NON BLOQUANT : la mutation appelante a deja ete
    // committee au moment ou logAudit est appelee (voir quick-add, budget,
    // donnees), donc une erreur ici ne doit jamais faire echouer la reponse
    // HTTP. Le seul changement est la VISIBILITE : console.error atterrit
    // dans les logs Vercel / Sentry, au lieu de disparaitre.
    console.error('[logAudit]', params.action, params.entityType ?? '', e);
  }
}