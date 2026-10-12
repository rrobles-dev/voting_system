import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/** Falla al arrancar si falta config: mejor que fallar a mitad de una votación. */
export const env = {
  codePepper: required('CODE_PEPPER'),
  auditEncKey: required('AUDIT_ENC_KEY'),
  adminKey: required('ADMIN_KEY'),
  auditorKey: required('AUDITOR_KEY'),
  smtpHost: process.env.SMTP_HOST ?? 'localhost',
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  mailFrom: process.env.MAIL_FROM ?? 'votacion@example.org',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
  port: Number(process.env.PORT ?? 3000),
  votingRateLimit: Number(process.env.VOTING_RATE_LIMIT ?? 30), // intentos por minuto por IP
  // Solo desarrollo/tests: la API devuelve los códigos emitidos. Nunca en producción.
  exposeCodes: process.env.NODE_ENV !== 'production' && process.env.EXPOSE_CODES === 'true',
};
