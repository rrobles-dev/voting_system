import { Global, Injectable, Module } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditEvent } from '../database/entities';
import { sha256 } from '../common/crypto';

const GENESIS = '0'.repeat(64);

/**
 * JSON canónico (claves ordenadas). Postgres jsonb NO conserva el orden de las claves,
 * así que sin esto el hash calculado al leer no coincidiría con el calculado al escribir.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/**
 * Log de auditoría encadenado (idea similar a un blockchain, sin la parte distribuida).
 * hash_n = SHA-256(hash_{n-1} + tipo + actor + payload). Modificar o borrar una fila
 * rompe todos los hashes siguientes, y verifyChain() lo detecta.
 */
@Injectable()
export class AuditService {
  constructor(private ds: DataSource) {}

  /** Recibe el EntityManager de la transacción: el evento se graba junto con la acción, o no se graba. */
  async log(em: EntityManager, electionId: string | null, type: string, actor: string, payload: Record<string, unknown>) {
    // Lock asesor de Postgres: serializa escrituras al log para que dos eventos
    // simultáneos no lean el mismo "último hash" y bifurquen la cadena.
    await em.query('SELECT pg_advisory_xact_lock(424242)');
    const last = await em.findOne(AuditEvent, { where: {}, order: { seq: 'DESC' } });
    const prevHash = last?.hash ?? GENESIS;
    const hash = sha256(prevHash + type + actor + canonical(payload));
    await em.save(em.create(AuditEvent, { electionId, type, actor, payload, prevHash, hash }));
  }

  async verifyChain(): Promise<{ ok: boolean; brokenAt?: number; total: number }> {
    const events = await this.ds.getRepository(AuditEvent).find({ order: { seq: 'ASC' } });
    let prev = GENESIS;
    for (const e of events) {
      const expected = sha256(prev + e.type + e.actor + canonical(e.payload));
      if (e.prevHash !== prev || e.hash !== expected) return { ok: false, brokenAt: e.seq, total: events.length };
      prev = e.hash;
    }
    return { ok: true, total: events.length };
  }

  list(electionId: string) {
    return this.ds.getRepository(AuditEvent).find({ where: { electionId }, order: { seq: 'ASC' } });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
