import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ZodSchema, ZodError } from 'zod';
import { logAudit, AuditAction } from '@/lib/audit';
import { verifyCsrf } from '@/lib/csrf';

// ── Auth ─────────────────────────────────────────────────────────────────────
export async function requireAuth(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { session: null, error: NextResponse.json({ error: 'Non authentifie' }, { status: 401 }) };
  }
  return { session, error: null };
}

// ── Zod validation ───────────────────────────────────────────────────────────
export function validateBody<T>(schema: ZodSchema<T>, data: unknown):
  { data: T; error: null } | { data: null; error: NextResponse } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = (result.error as ZodError).issues
      .map(i => i.path.join('.') + ': ' + i.message)
      .join(', ');
    return { data: null, error: NextResponse.json({ error: messages }, { status: 400 }) };
  }
  return { data: result.data, error: null };
}

// ── CSRF check (S1b) ─────────────────────────────────────────────────────────
// Conserve en defense en profondeur, mais delegue integralement a lib/csrf.ts.
// L'implementation locale dupliquait la faille startsWith + le fail-open :
// corriger le middleware seul aurait laisse une version vulnerable en circulation,
// prete a etre reutilisee dans une future route.
export function csrfCheck(req: NextRequest): NextResponse | null {
  const verdict = verifyCsrf(req);
  if (verdict.ok) return null;
  return NextResponse.json({ error: 'Requete non autorisee (CSRF)' }, { status: 403 });
}

// ── Audit helper ─────────────────────────────────────────────────────────────
export async function audit(params: {
  req:        NextRequest;
  userId:     string;
  action:     AuditAction;
  entityType?: string;
  entityId?:   string;
  entityNom?:  string;
  details?:    Record<string, any>;
}) {
  try {
    await logAudit({ ...params });
  } catch {}
}

// ── Wrapper complet (auth + csrf + zod + audit) ──────────────────────────────
export function createHandler<T = any>(config: {
  schema?:     ZodSchema<T>;
  auditAction?: AuditAction;
  entityType?:  string;
  requireAuth?: boolean;
  skipCsrf?:    boolean;
}) {
  return async function wrap(
    req:     NextRequest,
    handler: (ctx: { session: any; body: T; req: NextRequest }) => Promise<NextResponse>
  ): Promise<NextResponse> {
    // CSRF
    if (!config.skipCsrf) {
      const csrfErr = csrfCheck(req);
      if (csrfErr) return csrfErr;
    }

    // Auth
    let session: any = null;
    if (config.requireAuth !== false) {
      const { session: s, error } = await requireAuth(req);
      if (error) return error;
      session = s;
    }

    // Body + Zod
    let body: T = {} as T;
    if (config.schema && ['POST','PUT','PATCH'].includes(req.method.toUpperCase())) {
      try {
        const raw = await req.json();
        const { data, error } = validateBody(config.schema, raw);
        if (error) return error;
        body = data!;
      } catch {
        return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
      }
    }

    // Handler
    const response = await handler({ session, body, req });

    // Audit (apres succes uniquement)
    if (config.auditAction && session?.user?.id && response.status < 400) {
      await audit({
        req,
        userId:     session.user.id,
        action:     config.auditAction,
        entityType: config.entityType,
      });
    }

    return response;
  };
}