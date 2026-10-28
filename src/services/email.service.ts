import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

/**
 * שליחת מיילים.
 * - אם הוגדר SMTP_HOST: שליחה אמיתית (למשל דרך Brevo או Gmail).
 * - אחרת: המייל מודפס ללוג של השרת (מצב פיתוח), כדי שהמערכת תעבוד גם בלי חשבון מייל.
 * - בבדיקות אוטומטיות: המיילים נשמרים במערך sentEmails לבדיקה.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const sentEmails: EmailMessage[] = [];

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!config.smtp.host) return null;
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (config.isTest) {
    sentEmails.push(message);
    return true;
  }
  const t = getTransporter();
  if (!t) {
    // eslint-disable-next-line no-console
    console.log(`\n📧 [EMAIL - מצב פיתוח, לא נשלח באמת]\nTo: ${message.to}\nSubject: ${message.subject}\n${message.text}\n`);
    return true;
  }
  try {
    await t.sendMail({ from: config.emailFrom, ...message });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to send email to', message.to, err);
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title: string, lines: string[]): { text: string; html: string } {
  const text = [title, '', ...lines, '', 'QuickQ - תור מהיר, בלי לחכות'].join('\n');
  const html = `<!doctype html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
<h2 style="color:#2563eb">${escapeHtml(title)}</h2>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<hr><p style="color:#888;font-size:12px">QuickQ - תור מהיר, בלי לחכות</p></body></html>`;
  return { text, html };
}

export const emailTemplates = {
  reminder(p: {
    fullName: string;
    clinicName: string;
    providerName: string;
    estimatedTime: string;
    leaveAt: string;
    queueNumber: number | null;
    peopleAhead: number | null;
  }) {
    const lines = [
      `שלום ${p.fullName},`,
      `הגיע הזמן להתארגן! התור שלך אצל ${p.providerName} ב${p.clinicName} צפוי בערך ב-${p.estimatedTime}.`,
      `כדאי לצאת מהבית ב-${p.leaveAt}.`,
    ];
    if (p.queueNumber !== null) lines.push(`מספר התור שלך: ${p.queueNumber}${p.peopleAhead !== null ? ` · לפנייך: ${p.peopleAhead}` : ''}`);
    lines.push('השעה היא הערכה לפי קצב התור הנוכחי. אפשר לעקוב בזמן אמת באתר.');
    lines.push(`${config.frontendUrl}`);
    return { subject: `⏰ QuickQ: הגיע הזמן לצאת לתור ב-${p.clinicName}`, ...layout('תזכורת לתור', lines) };
  },

  cancelledByClinic(p: { fullName: string; clinicName: string; providerName: string; date: string; time: string; reason?: string | null }) {
    const lines = [
      `שלום ${p.fullName},`,
      `מצטערים, התור שלך אצל ${p.providerName} ב${p.clinicName} בתאריך ${p.date} בשעה ${p.time} בוטל על ידי הקליניקה.`,
    ];
    if (p.reason) lines.push(`סיבה: ${p.reason}`);
    lines.push('אפשר לקבוע תור חדש באתר:', config.frontendUrl);
    return { subject: `QuickQ: התור שלך ב-${p.clinicName} בוטל`, ...layout('התור בוטל', lines) };
  },

  welcomeStaff(p: { fullName: string; clinicName: string; email: string; temporaryPassword: string }) {
    const lines = [
      `שלום ${p.fullName},`,
      `נוצר עבורך חשבון ניהול לקליניקה "${p.clinicName}" במערכת QuickQ.`,
      `מייל להתחברות: ${p.email}`,
      `סיסמה זמנית: ${p.temporaryPassword}`,
      'בכניסה הראשונה תתבקשי להחליף את הסיסמה.',
      config.frontendUrl,
    ];
    return { subject: 'ברוכים הבאים ל-QuickQ', ...layout('החשבון שלך מוכן', lines) };
  },

  joinRequestRejected(p: { contactName: string; clinicName: string; reason?: string | null }) {
    const lines = [`שלום ${p.contactName},`, `תודה על פנייתך להצטרף ל-QuickQ עם "${p.clinicName}".`, 'לצערנו, לא נוכל לאשר את הפנייה בשלב זה.'];
    if (p.reason) lines.push(`סיבה: ${p.reason}`);
    return { subject: 'QuickQ: עדכון לגבי פניית ההצטרפות', ...layout('עדכון פנייה', lines) };
  },

  passwordReset(p: { fullName: string; code: string }) {
    const lines = [
      `שלום ${p.fullName},`,
      `קוד שחזור הסיסמה שלך: ${p.code}`,
      'הקוד תקף ל-15 דקות. אם לא ביקשת לשחזר סיסמה - אפשר להתעלם מהמייל.',
    ];
    return { subject: 'QuickQ: קוד לשחזור סיסמה', ...layout('שחזור סיסמה', lines) };
  },

  passwordResetByAdmin(p: { fullName: string; temporaryPassword: string }) {
    const lines = [
      `שלום ${p.fullName},`,
      `הסיסמה שלך אופסה על ידי מנהל המערכת.`,
      `סיסמה זמנית: ${p.temporaryPassword}`,
      'בכניסה הבאה תתבקשי להחליף אותה.',
    ];
    return { subject: 'QuickQ: הסיסמה שלך אופסה', ...layout('איפוס סיסמה', lines) };
  },
};
