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
