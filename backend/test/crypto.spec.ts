import { CODE_ALPHABET, decrypt, encrypt, generateCode, hashCode, truncateToHour } from '../src/common/crypto';

describe('crypto', () => {
  it('genera códigos del largo pedido y solo con el alfabeto sin ambiguos', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode(9);
      expect(code).toHaveLength(9);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[0O1lIo]/);
    }
  });

  it('no repite códigos en 10.000 generaciones', () => {
    const set = new Set(Array.from({ length: 10_000 }, () => generateCode(9)));
    expect(set.size).toBe(10_000);
  });

  it('el hash distingue mayúsculas de minúsculas', () => {
    expect(hashCode('aBcDeFgHj', 'pepper')).not.toBe(hashCode('AbCdEfGhJ', 'pepper'));
    expect(hashCode('aBcDeFgHj', 'pepper')).toBe(hashCode('aBcDeFgHj', 'pepper'));
  });

  it('el hash cambia con otro pepper', () => {
    expect(hashCode('aBcDeFgHj', 'uno')).not.toBe(hashCode('aBcDeFgHj', 'dos'));
  });

  it('cifra y descifra IPs, y detecta manipulación', () => {
    const key = 'a'.repeat(64);
    const enc = encrypt('190.161.10.5', key);
    expect(enc).not.toContain('190.161');
    expect(decrypt(enc, key)).toBe('190.161.10.5');
    const [iv, tag, data] = enc.split('.');
    const tampered = [iv, tag, Buffer.from('xxxx').toString('base64') + data.slice(8)].join('.');
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('trunca a la hora', () => {
    expect(truncateToHour(new Date('2026-10-12T14:37:21.555Z')).toISOString()).toBe('2026-10-12T14:00:00.000Z');
  });
});
