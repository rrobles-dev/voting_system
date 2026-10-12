/**
 * Textos de la interfaz del votante en un solo lugar.
 * Cada pantalla explica qué se espera de la persona (requisito funcional).
 * v2: estos textos pasan a ser configurables por elección desde el admin.
 */
export const T = {
  welcome: {
    title: 'Bienvenido al proceso de votación',
    lead: 'Este sistema te permite ejercer el derecho a voto de tu empresa desde cualquier lugar y dispositivo.',
    steps: [
      'Ingresa el código personal que recibiste por correo.',
      'Revisa los candidatos y marca tu preferencia.',
      'Confirma tu voto. Recibirás un comprobante en pantalla y por correo.',
    ],
    codeLabel: 'Código de votación',
    codeHelp: 'Escríbelo tal como aparece en el correo: distingue mayúsculas de minúsculas.',
    submit: 'Ingresar',
    privacy:
      'Tu voto es secreto: el sistema registra que tu empresa votó, pero guarda la selección por separado y sin vínculo con tu identidad. ' +
      'Los datos del padrón fueron entregados por la organización convocante y se usan solo para este proceso.',
    verifyLink: '¿Ya votaste? Verifica tu comprobante',
  },
  ballot: {
    votingAs: 'Votando en representación de',
    instructions: (min: number, max: number, seats: number) =>
      max === 1
        ? 'Marca un candidato.'
        : `Se eligen ${seats} cupos. Marca ${min > 0 ? `entre ${min} y ` : 'hasta '}${max} candidatos.`,
    counter: (n: number, max: number) => `${n} de ${max} marcados`,
    review: 'Revisar mi voto',
    closesAt: 'La votación cierra el',
  },
  review: {
    title: 'Revisa tu voto antes de enviarlo',
    lead: 'Una vez enviado no podrás modificarlo. Si todo está correcto, confirma.',
    none: 'Sin selección (voto en blanco para este cargo)',
    back: 'Volver y corregir',
    confirm: 'Confirmar y enviar voto',
    sending: 'Enviando…',
  },
  done: {
    title: 'Tu voto fue registrado',
    lead: 'Gracias por participar. También te enviamos esta confirmación por correo.',
    receiptLabel: 'Tu código de recibo',
    receiptHelp:
      'Guárdalo. Te permite verificar que tu voto fue contado. Es el único dato que vincula tu voto contigo: la comisión no puede saber por quién votaste.',
    copy: 'Copiar código',
    copied: 'Copiado',
    exit: 'Finalizar',
  },
  verify: {
    title: 'Verificar comprobante',
    lead: 'Ingresa el código de recibo que obtuviste al votar para confirmar que tu voto está registrado.',
    label: 'Código de recibo',
    submit: 'Verificar',
    found: 'Tu voto está registrado y será contado.',
    annulled: 'Este voto fue anulado por la comisión a solicitud del votante.',
    notFound: 'No encontramos un voto con ese código. Revisa que esté bien escrito.',
  },
};
