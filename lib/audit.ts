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
  } catch {}
}