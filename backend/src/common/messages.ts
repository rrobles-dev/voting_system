/**
 * Todos los textos de correo en un solo lugar.
 * v2: estos textos pasan a ser configurables por elección desde el admin.
 */
const fmt = (d: Date) =>
  d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' });

export const MESSAGES = {
  email: {
    code: {
      subject: (title: string) => `Tu código para votar: ${title}`,
      body: (org: string, title: string, code: string, closesAt: Date, url: string) =>
        `Estimado/a representante de ${org}:

Se ha abierto el proceso "${title}". Tu código personal de votación es:

    ${code}

Ingresa en ${url} y escribe el código tal cual aparece (distingue mayúsculas de minúsculas).
El código es de un solo uso y es personal: no lo compartas.

La votación cierra el ${fmt(closesAt)}.

Si no solicitaste este código o tienes problemas para votar, contacta a la comisión electoral.`,
    },
    confirmation: {
      subject: (title: string) => `Confirmación de voto: ${title}`,
      body: (title: string, receipt: string, votedAt: Date) =>
        `Tu voto en "${title}" fue registrado correctamente el ${fmt(votedAt)}.

Código de recibo: ${receipt}

Guarda este código. Te permite verificar que tu voto fue contado y es el único dato
que vincula tu voto contigo: la comisión no puede saber por quién votaste.
Por eso este correo no incluye tu selección.`,
    },
    opened: (title: string, closesAt: Date) => ({
      subject: `Abierta la votación: ${title}`,
      body: `El proceso "${title}" está abierto hasta el ${fmt(closesAt)}. Revisa el correo con tu código personal.`,
    }),
    closed: (title: string) => ({
      subject: `Cerrada la votación: ${title}`,
      body: `El proceso "${title}" ha cerrado. La comisión publicará los resultados próximamente. Gracias por participar.`,
    }),
    reminder: (title: string, closesAt: Date) => ({
      subject: `Recordatorio: aún no has votado en ${title}`,
      body: `Te recordamos que la votación "${title}" cierra el ${fmt(closesAt)}. Tu participación es importante.`,
    }),
  },
};
