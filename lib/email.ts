import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host:   process.env.BREVO_SMTP_HOST,
  port:   Number(process.env.BREVO_SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY,
  },
});

export async function envoyerEmailReset(
  destinataire: string,
  token: string,
  nom?: string
) {
  const lien = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"${process.env.BREVO_FROM_NAME}" <${process.env.BREVO_FROM_EMAIL}>`,
    to:   destinataire,
    subject: 'GestBudget — Réinitialisation de votre mot de passe',
    html: `
      <!DOCTYPE html>
      <html lang="fr">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Inter, Arial, sans-serif; background: #F8FAFC; margin: 0; padding: 20px;">
        <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1E3A8A, #1E40AF); padding: 32px; text-align: center;">
            <span style="font-size: 36px;">💰</span>
            <h1 style="color: white; margin: 8px 0 0; font-size: 22px; font-weight: 700;">GestBudget</h1>
            <p style="color: #93C5FD; margin: 4px 0 0; font-size: 13px;">Gestion de budget mensuel</p>
          </div>

          <!-- Corps -->
          <div style="padding: 32px;">
            <h2 style="color: #1E293B; font-size: 18px; margin: 0 0 12px;">
              Bonjour ${nom ?? destinataire} 👋
            </h2>
            <p style="color: #64748B; line-height: 1.6; margin: 0 0 24px;">
              Vous avez demandé à réinitialiser votre mot de passe GestBudget.
              Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${lien}"
                style="background: #1E40AF; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block;">
                Réinitialiser mon mot de passe
              </a>
            </div>
            <p style="color: #94A3B8; font-size: 13px; margin: 24px 0 0; border-top: 1px solid #F1F5F9; padding-top: 16px;">
              ⏱️ Ce lien est valable <strong>1 heure</strong>.<br>
              Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
            </p>
          </div>

          <!-- Footer -->
          <div style="background: #F8FAFC; padding: 16px 32px; text-align: center;">
            <p style="color: #94A3B8; font-size: 12px; margin: 0;">
              © 2026 GestBudget — Contact : ${process.env.BREVO_FROM_EMAIL}
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

export async function envoyerEmailBienvenue(
  destinataire: string,
  nom?: string
) {
  await transporter.sendMail({
    from: `"${process.env.BREVO_FROM_NAME}" <${process.env.BREVO_FROM_EMAIL}>`,
    to:   destinataire,
    subject: 'Bienvenue sur GestBudget 🎉',
    html: `
      <!DOCTYPE html>
      <html lang="fr">
      <body style="font-family: Inter, Arial, sans-serif; background: #F8FAFC; margin: 0; padding: 20px;">
        <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <div style="background: linear-gradient(135deg, #1E3A8A, #1E40AF); padding: 32px; text-align: center;">
            <span style="font-size: 36px;">💰</span>
            <h1 style="color: white; margin: 8px 0 0; font-size: 22px; font-weight: 700;">GestBudget</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #1E293B; font-size: 18px; margin: 0 0 12px;">
              Bienvenue ${nom ?? ''} ! 🎉
            </h2>
            <p style="color: #64748B; line-height: 1.6;">
              Votre compte GestBudget a été créé avec succès. 
              Vos catégories et comptes de fonds de roulement ont été initialisés.
            </p>
            <p style="color: #64748B; line-height: 1.6; margin-top: 12px;">
              Commencez par saisir votre budget anticipé pour ce mois,
              puis enregistrez vos dépenses réelles au fil du mois.
            </p>
            <div style="text-align: center; margin-top: 24px;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
                style="background: #1E40AF; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; display: inline-block;">
                Accéder à mon tableau de bord
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

// ── Rapport mensuel ───────────────────────────────────────────────────────────
const MOIS_NOMS_R = ['','Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

function fCFAEmail(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';
}

export async function envoyerRapportMensuel(params: {
  destinataire:          string;
  nom?:                  string;
  mois:                  number;
  annee:                 number;
  score:                 number;
  revenus:               number;
  depenses:              number;
  epargne:               number;
  solde:                 number;
  epargneFonctionnement: number;
  epargneGlobale:        number;
  anomalies:             { categorie: string; ecart: number }[];
}) {
  const { destinataire, nom, mois, annee, score, revenus, depenses,
    epargne, solde, epargneFonctionnement, epargneGlobale, anomalies } = params;

  const scoreColor = score >= 16 ? '#10B981' : score >= 12 ? '#F59E0B' : '#EF4444';
  const scoreLabel = score >= 16 ? 'Excellent' : score >= 12 ? 'Bon' : 'A ameliorer';
  const moisNom    = MOIS_NOMS_R[mois] ?? String(mois);
  const tauxEp     = revenus > 0 ? ((epargne / revenus) * 100).toFixed(1) : '0.0';
  const soldeColor = solde >= 0 ? '#10B981' : '#EF4444';
  const soldeStr   = (solde >= 0 ? '+' : '') + fCFAEmail(solde);

  const conseil = score >= 16
    ? 'Excellente gestion ce mois ! Continuez sur cette lancee.'
    : score >= 12
    ? `Bonne gestion. Essayez d'augmenter votre taux d'epargne au-dela de ${Math.min(100, parseFloat(tauxEp) + 5).toFixed(0)}%.`
    : 'Attention : votre solde ou taux d\'epargne necessite un ajustement. Revisez vos depenses variables.';

  const anomaliesRows = anomalies.length > 0
    ? anomalies.map(a =>
        `<tr><td style="padding:8px 12px;font-size:13px;color:#374151;">${a.categorie}</td>` +
        `<td style="padding:8px 12px;font-size:13px;font-weight:700;color:#EF4444;text-align:right;">+${a.ecart}% vs mois prec.</td></tr>`
      ).join('')
    : '<tr><td colspan="2" style="padding:8px 12px;font-size:13px;color:#6B7280;text-align:center;">Aucune anomalie detectee</td></tr>';

  const anomaliesSection = anomalies.length > 0
    ? `<div style="padding:20px 32px;border-bottom:1px solid #F1F5F9;background:#FFF7ED;">
         <h2 style="color:#92400E;font-size:14px;margin:0 0 10px;font-weight:700;">Anomalies detectees</h2>
         <table style="width:100%;border-collapse:collapse;">${anomaliesRows}</table>
       </div>` : '';

  await transporter.sendMail({
    from:    `"${process.env.BREVO_FROM_NAME}" <${process.env.BREVO_FROM_EMAIL}>`,
    to:      destinataire,
    subject: `GestBudget — Rapport ${moisNom} ${annee} | Score : ${score}/20`,
    html: `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F8FAFC;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <div style="background:linear-gradient(135deg,#1E3A8A,#1E40AF);padding:28px 32px;text-align:center;">
    <span style="font-size:32px;">💰</span>
    <h1 style="color:white;margin:8px 0 0;font-size:20px;font-weight:700;">GestBudget</h1>
    <p style="color:#93C5FD;margin:4px 0 0;font-size:13px;">Rapport mensuel — ${moisNom} ${annee}</p>
  </div>

  <div style="padding:24px 32px;text-align:center;border-bottom:1px solid #F1F5F9;">
    <p style="color:#6B7280;font-size:12px;margin:0 0 6px;">Score financier du mois</p>
    <span style="font-size:52px;font-weight:800;color:${scoreColor};">${score}</span>
    <span style="font-size:20px;color:#9CA3AF;">/20</span>
    <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:${scoreColor};">${scoreLabel}</p>
    <p style="color:#6B7280;font-size:12px;margin:6px 0 0;">Taux d'epargne : ${tauxEp}%</p>
  </div>

  <div style="padding:24px 32px;border-bottom:1px solid #F1F5F9;">
    <h2 style="color:#1E293B;font-size:14px;margin:0 0 14px;font-weight:700;">Bilan ${moisNom} ${annee}</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="background:#EFF6FF;"><td style="padding:10px 12px;font-size:13px;color:#6B7280;border-radius:8px 0 0 8px;">Revenus</td><td style="padding:10px 12px;font-size:14px;font-weight:700;color:#1E40AF;text-align:right;border-radius:0 8px 8px 0;">${fCFAEmail(revenus)}</td></tr>
      <tr><td style="padding:10px 12px;font-size:13px;color:#6B7280;">Depenses</td><td style="padding:10px 12px;font-size:14px;font-weight:700;color:#EF4444;text-align:right;">${fCFAEmail(depenses)}</td></tr>
      <tr style="background:#F0FDF4;"><td style="padding:10px 12px;font-size:13px;color:#6B7280;border-radius:8px 0 0 8px;">Epargne</td><td style="padding:10px 12px;font-size:14px;font-weight:700;color:#10B981;text-align:right;border-radius:0 8px 8px 0;">${fCFAEmail(epargne)}</td></tr>
      <tr style="border-top:2px solid #F1F5F9;"><td style="padding:12px;font-size:13px;font-weight:700;color:#374151;">Solde net</td><td style="padding:12px;font-size:16px;font-weight:800;color:${soldeColor};text-align:right;">${soldeStr}</td></tr>
    </table>
  </div>

  <div style="padding:20px 32px;border-bottom:1px solid #F1F5F9;background:#F0FDF4;">
    <h2 style="color:#166534;font-size:14px;margin:0 0 12px;font-weight:700;">Epargne globale actuelle</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px;font-size:12px;color:#6B7280;">Fonctionnement (fonds)</td><td style="padding:8px;font-size:14px;font-weight:700;color:#166534;text-align:right;">${fCFAEmail(epargneFonctionnement)}</td></tr>
      <tr><td style="padding:8px;font-size:12px;color:#6B7280;">Precaution (banques)</td><td style="padding:8px;font-size:14px;font-weight:700;color:#166534;text-align:right;">${fCFAEmail(epargneGlobale)}</td></tr>
    </table>
  </div>

  ${anomaliesSection}

  <div style="padding:20px 32px;border-bottom:1px solid #F1F5F9;background:#EFF6FF;">
    <h2 style="color:#1E40AF;font-size:14px;margin:0 0 8px;font-weight:700;">Conseil du mois</h2>
    <p style="color:#1E3A8A;font-size:13px;margin:0;line-height:1.6;">${conseil}</p>
  </div>

  <div style="padding:20px 32px;text-align:center;border-bottom:1px solid #F1F5F9;">
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="background:#1E40AF;color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;display:inline-block;">Voir mon tableau de bord</a>
  </div>

  <div style="background:#F8FAFC;padding:16px 32px;text-align:center;">
    <p style="color:#94A3B8;font-size:11px;margin:0;">
      © ${annee} GestBudget &nbsp;|&nbsp;
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/parametres" style="color:#94A3B8;">Desactiver ce rapport</a>
    </p>
  </div>
</div>
</body></html>`,
  });
}