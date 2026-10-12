import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'crypto';

/**
 * Alfabeto sin caracteres ambiguos: fuera 0/O/o, 1/l/I.
 * Quedan 56 símbolos. Con 9 caracteres: 56^9 ≈ 5,4 × 10^15 combinaciones.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Genera un código con randomInt (CSPRNG). Nunca Math.random:
 * Math.random no es criptográficamente seguro y su salida es predecible.
 */
export function generateCode(length = 9): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * HMAC en vez de bcrypt: necesitamos BUSCAR el código por su hash
 * (WHERE codeHash = ?). bcrypt usa salt aleatorio por fila, así que no
 * permite búsqueda. El pepper (secreto del servidor) evita que alguien
 * con una copia de la base pueda probar códigos offline.
 * Es case-sensitive a propósito: "aB3" y "Ab3" son códigos distintos.
 */
export function hashCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Recibo que se entrega al votante: 12 caracteres, mismo alfabeto. */
export function generateReceipt(): string {
  return generateCode(12);
}

/** Trunca a la hora para que Ballot.castHour no permita cruzar con Participation.votedAt. */
export function truncateToHour(d: Date): Date {
  const t = new Date(d);
  t.setUTCMinutes(0, 0, 0);
  return t;
}

/** AES-256-GCM: cifrado autenticado (detecta si alguien modificó el texto cifrado). */
export function encrypt(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string, keyHex: string): string {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
