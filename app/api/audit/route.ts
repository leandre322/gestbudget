import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Types d'actions auditées
export type AuditAction =
  | 'delete_categorie'
  | 'delete_compte_fonds'
  | 'delete_banque'
  | 'delete_decaissement'
  | 'delete_donnees'
  | 'update_parametres'
  | 'update_solde_fond'
  | 'update_solde_banque'
  | 'import_excel'
  | 'copy_mois'
  | 'copy_annee';

// POST /api/audit — Enregistrer une action sensible
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const {
      action,
      entityType,
      entityId,
      entityNom,
      details,
    } = await req.json();

    if (!action) {
      return NextResponse.json({ error: 'action manquante' }, { status: 400 });
    }

    // IP depuis les headers (best-effort)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? null;

    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, entity_type, entity_id, entity_nom, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.user.id,
        action,
        entityType ?? null,
        entityId   ?? null,
        entityNom  ?? null,
        details ? JSON.stringify(details) : null,
        ip,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (e: any) {
    // Ne pas bloquer l'action principale si l'audit échoue
    console.error('POST /api/audit:', e?.message);
    return NextResponse.json({ success: false, error: e?.message });
  }
}

// GET /api/audit?limit=50&offset=0 — Lire le journal (optionnel, pour affichage futur)
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit  = Math.min(100, parseInt(searchParams.get('limit')  ?? '50'));
    const offset = parseInt(searchParams.get('offset') ?? '0');

    const result = await pool.query(
      `SELECT id, action, entity_type, entity_nom, details, created_at
       FROM audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [session.user.id, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM audit_logs WHERE user_id = $1',
      [session.user.id]
    );

    return NextResponse.json({
      logs:  result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
