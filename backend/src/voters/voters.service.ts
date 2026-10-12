import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { DataSource } from 'typeorm';
import { AccessCode, CodeStatus, Election, ElectionStatus, Participation, Voter } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { generateCode, hashCode } from '../common/crypto';
import { env } from '../common/env';
import { MESSAGES } from '../common/messages';

interface CsvRow {
  ref: string;
  organization: string;
  email: string;
  weight?: string;
  eligible?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEligible = (v?: string) => !['false', 'no', '0'].includes((v ?? 'true').toLowerCase());

@Injectable()
export class VotersService {
  constructor(private ds: DataSource, private audit: AuditService, private mail: MailService) {}

  /** Votantes elegibles que aún no tienen una participación vigente (no anulada). */
  private pendingVoters(electionId: string, voterId?: string) {
    const qb = this.ds.getRepository(Voter).createQueryBuilder('v')
      .where('v.electionId = :electionId AND v.eligible = true', { electionId })
      .andWhere((sub) => {
        const q = sub.subQuery().select('1').from(Participation, 'p')
          .where('p.voterId = v.id AND p.annulled = false').getQuery();
        return `NOT EXISTS ${q}`;
      });
    if (voterId) qb.andWhere('v.id = :voterId', { voterId });
    return qb.orderBy('v.organization', 'ASC').getMany();
  }

  /**
   * Importa el padrón desde CSV. Columnas: ref, organization, email, weight, eligible.
   * Valida TODO antes de escribir: si una fila falla, no se importa nada
   * (mejor un error claro que un padrón a medias).
   */
  async importCsv(electionId: string, csv: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (election.status !== ElectionStatus.DRAFT) throw new BadRequestException('El padrón solo se carga en estado borrador');

    let rows: CsvRow[];
    try {
      rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (e) {
      throw new BadRequestException(`No se pudo leer el CSV: ${(e as Error).message}`);
    }
    const errors: string[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2; // +1 por el encabezado, +1 porque las filas parten en 1
      if (!r.ref) errors.push(`Fila ${line}: falta ref`);
      if (!r.organization) errors.push(`Fila ${line}: falta organization`);
      if (!EMAIL_RE.test(r.email ?? '')) errors.push(`Fila ${line}: email inválido`);
      if (r.weight && !/^[1-9]\d*$/.test(r.weight)) errors.push(`Fila ${line}: weight debe ser entero positivo`);
      if (seen.has(r.ref)) errors.push(`Fila ${line}: ref duplicado (${r.ref})`);
      seen.add(r.ref);
    });
    if (rows.length === 0) errors.push('El CSV no tiene filas');
    if (errors.length) throw new BadRequestException({ message: 'CSV inválido', errors });

    const eligible = rows.filter((r) => isEligible(r.eligible)).length;
    await this.ds.transaction(async (em) => {
      await em.delete(Voter, { electionId }); // reemplaza el padrón completo
      await em.insert(Voter, rows.map((r) => ({
        electionId,
        externalRef: r.ref,
        organization: r.organization,
        email: r.email,
        weight: r.weight ? Number(r.weight) : 1,
        eligible: isEligible(r.eligible),
      })));
      await this.audit.log(em, electionId, 'ROLL_IMPORTED', 'ADMIN', { total: rows.length, eligible });
    });
    return { total: rows.length, eligible, notEligible: rows.length - eligible };
  }

  /**
   * Emite códigos a los elegibles que aún no votaron.
   * Si un votante ya tenía código activo, se invalida y se emite uno nuevo:
   * nunca hay dos códigos válidos para la misma persona.
   */
  async issueCodes(electionId: string, voterId?: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (![ElectionStatus.DRAFT, ElectionStatus.OPEN].includes(election.status)) {
      throw new BadRequestException('La elección ya cerró');
    }

    const voters = await this.pendingVoters(electionId, voterId);
    if (voterId && voters.length === 0) throw new BadRequestException('Votante no elegible o ya votó');

    const issued: { voterId: string; organization: string; code?: string }[] = [];
    for (const v of voters) {
      const code = generateCode(election.codeLength);
      await this.ds.transaction(async (em) => {
        await em.update(AccessCode, { voterId: v.id, status: CodeStatus.ACTIVE }, { status: CodeStatus.INVALIDATED });
        await em.insert(AccessCode, { voterId: v.id, codeHash: hashCode(code, env.codePepper) });
        await this.audit.log(em, electionId, voterId ? 'CODE_REISSUED' : 'CODE_ISSUED', 'ADMIN', { voterId: v.id });
      });
      await this.mail.sendCode(v.email, v.organization, election.title, code, election.closesAt).catch(() => null);
      // Solo en desarrollo: se devuelven los códigos para probar sin abrir el correo.
      issued.push({ voterId: v.id, organization: v.organization, ...(env.exposeCodes ? { code } : {}) });
    }
    return { issued: issued.length, voters: issued };
  }

  /** Participación: quién votó y quién no. NUNCA qué votaron. */
  async participation(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    const voters = await this.ds.getRepository(Voter).find({ where: { electionId }, order: { organization: 'ASC' } });
    const parts = await this.ds.getRepository(Participation).find({ where: { electionId, annulled: false } });
    const votedAt = new Map(parts.map((p) => [p.voterId, p.votedAt]));

    const eligible = voters.filter((v) => v.eligible);
    const voted = eligible.filter((v) => votedAt.has(v.id));
    const percent = eligible.length ? Math.round((voted.length / eligible.length) * 1000) / 10 : 0;
    return {
      status: election.status,
      eligible: eligible.length,
      voted: voted.length,
      percent,
      quorumPercent: election.quorumPercent,
      quorumReached: election.quorumPercent == null ? null : percent >= election.quorumPercent,
      voters: voters.map((v) => ({
        id: v.id,
        ref: v.externalRef,
        organization: v.organization,
        email: v.email,
        eligible: v.eligible,
        votedAt: votedAt.get(v.id) ?? null,
      })),
    };
  }

  async sendReminders(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (election.status !== ElectionStatus.OPEN) throw new BadRequestException('Solo se recuerda con la elección abierta');
    const pending = await this.pendingVoters(electionId);
    const msg = MESSAGES.email.reminder(election.title, election.closesAt);
    const results = await Promise.allSettled(pending.map((v) => this.mail.sendNotice(v.email, msg.subject, msg.body)));
    await this.ds.transaction((em) => this.audit.log(em, electionId, 'REMINDERS_SENT', 'ADMIN', { count: pending.length }));
    return { sent: results.filter((r) => r.status === 'fulfilled').length, pending: pending.length };
  }
}
