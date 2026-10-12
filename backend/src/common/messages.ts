/**
 * Todos los textos de correo en un solo lugar.
 * v2: estos textos pasan a ser configurables por elección desde el admin.
 */
const fmt = (d: Date) =>
  d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' });

/** Texto del plazo: si el cierre es manual, la fecha es solo referencial y se dice explícitamente. */
export const closingText = (closesAt: Date, autoClose: boolean) =>
  autoClose
    ? `La votación cierra el ${fmt(closesAt)}.`
    : `Fecha estimada de cierre: ${fmt(closesAt)}. La comisión cerrará el proceso manualmente y lo avisará por correo.`;

type Window = { closesAt: Date; autoClose: boolean };

export const MESSAGES = {
  email: {
    code: {
      subject: (title: string) => `Tu código para votar: ${title}`,
      body: (org: string, title: string, code: string, w: Window, url: string) =>
        `Estimado/a representante de ${org}:

Se ha abierto el proceso "${title}". Tu código personal de votación es:

    ${code}

Ingresa en ${url} y escribe el código tal cual aparece (distingue mayúsculas de minúsculas).
El código es de un solo uso y es personal: no lo compartas.

${closingText(w.closesAt, w.autoClose)}

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
    opened: (title: string, w: Window) => ({
      subject: `Abierta la votación: ${title}`,
      body: `El proceso "${title}" está abierto. ${closingText(w.closesAt, w.autoClose)} Revisa el correo con tu código personal.`,
    }),
    closed: (title: string) => ({
      subject: `Cerrada la votación: ${title}`,
      body: `El proceso "${title}" ha cerrado. La comisión publicará los resultados próximamente. Gracias por participar.`,
    }),
    officialResults: (
      snap: { election: { title: string }; participation: { voted: number; eligible: number; percent: number };
        positions: { name: string; ranking: { name: string; votes: number; status: string }[] }[] },
      version: number, hash: string,
    ) => ({
      subject: `Resultados oficiales: ${snap.election.title}`,
      body: `La comisión electoral informa los resultados oficiales de "${snap.election.title}".

Participación: ${snap.participation.voted} de ${snap.participation.eligible} empresas habilitadas (${snap.participation.percent}%).

${snap.positions.map((p) => `${p.name} - electos:\n${p.ranking.filter((c) => c.status === 'ELECTED').map((c) => `  · ${c.name} (${c.votes} votos)`).join('\n')}`).join('\n\n')}

Acta oficial versión ${version}. Huella digital (SHA-256): ${hash}

Gracias por participar.`,
    }),
    reminder: (title: string, w: Window) => ({
      subject: `Recordatorio: aún no has votado en ${title}`,
      body: `Te recordamos que la votación "${title}" sigue abierta. ${closingText(w.closesAt, w.autoClose)} Tu participación es importante.`,
    }),
  },
};
