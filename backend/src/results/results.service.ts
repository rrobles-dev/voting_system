import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Ballot, BallotSelection, BallotStatus, ElectionStatus, Participation } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ElectionsService } from '../elections/elections.service';
import { decrypt } from '../common/crypto';
import { env } from '../common/env';
import { tallyPosition } from './tally';

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'); // BOM: Excel lee bien los acentos

@Injectable()
export class ResultsService {
  constructor(private ds: DataSource, private audit: AuditService, private elections: ElectionsService) {}

  private async assertClosed(electionId: string) {
    const election = await this.elections.get(electionId);
    if (![ElectionStatus.CLOSED, ElectionStatus.TALLIED].includes(election.status)) {
      throw new ForbiddenException('Disponible solo con la votación cerrada');
    }
    return election;
  }

  /**
   * Resultados SOLO con la elección cerrada. Mientras está abierta no hay forma
   * de consultar conteos: es una garantía del sistema, no una opción de la UI.
   */
  async results(electionId: string) {
    const election = await this.assertClosed(electionId);

    // SELECT s.candidateId, COUNT(*) FROM ballot_selection s JOIN ballot b ... GROUP BY s.candidateId
    const grouped: { candidateId: string; votes: string }[] = await this.ds.getRepository(BallotSelection)
      .createQueryBuilder('s')
      .innerJoin('s.ballot', 'b')
      .select('s.candidateId', 'candidateId')
      .addSelect('COUNT(*)', 'votes')
      .where('b.electionId = :electionId AND b.status = :status', { electionId, status: BallotStatus.VALID })
      .groupBy('s.candidateId')
      .getRawMany();
    const votesBy = new Map(grouped.map((g) => [g.candidateId, Number(g.votes)])); // COUNT llega como string desde pg

    const ballots = this.ds.getRepository(Ballot);
    const [validBallots, annulledBallots] = await Promise.all([
      ballots.countBy({ electionId, status: BallotStatus.VALID }),
      ballots.countBy({ electionId, status: BallotStatus.ANNULLED }),
    ]);

    return {
      election: { id: election.id, title: election.title, status: election.status, closesAt: election.closesAt },
      validBallots,
      annulledBallots,
      positions: election.positions.map((p) => ({
        id: p.id,
        name: p.name,
        seats: p.seats,
        ...tallyPosition(p.candidates.map((c) => ({ candidateId: c.id, name: c.name, votes: votesBy.get(c.id) ?? 0 })), p.seats),
      })),
    };
  }

  /** Declara escrutada la elección. Queda registrado quién y cuándo. */
  async tally(electionId: string) {
    await this.elections.transition(electionId, ElectionStatus.TALLIED, 'ADMIN');
    return this.results(electionId);
  }

  async resultsCsv(electionId: string) {
    const r = await this.results(electionId);
    const rows: unknown[][] = [['cargo', 'cupos', 'candidato', 'votos', 'estado']];
    for (const p of r.positions) for (const c of p.ranking) rows.push([p.name, p.seats, c.name, c.votes, c.status]);
    rows.push([], ['boletas válidas', r.validBallots], ['boletas anuladas', r.annulledBallots]);
    return toCsv(rows);
  }

  /**
   * Reporte de participación. Los datos de conexión solo se descifran para el rol
   * AUDITOR, exigiendo un motivo, y el acceso queda en el log.
   */
  async participationCsv(electionId: string, role: string, reason?: string) {
    await this.elections.get(electionId);
    const includeConnection = role === 'AUDITOR';
    if (includeConnection && (!reason || reason.trim().length < 10)) {
      throw new BadRequestException('Indica el motivo del acceso (mínimo 10 caracteres)');
    }
    await this.ds.transaction((em) =>
      this.audit.log(em, electionId, 'AUDIT_REPORT_ACCESSED', role, { includeConnection, reason: reason ?? null }),
    );

    const parts = await this.ds.getRepository(Participation).find({
      where: { electionId },
      order: { votedAt: 'ASC' },
      relations: { voter: true, code: true },
    });
    const header = ['ref', 'organizacion', 'codigo_emitido', 'votado_en', 'anulada'];
    if (includeConnection) header.push('ip', 'user_agent');
    const rows: unknown[][] = [header];
    for (const p of parts) {
      const row: unknown[] = [p.voter.externalRef, p.voter.organization, p.code.issuedAt.toISOString(), p.votedAt.toISOString(), p.annulled];
      if (includeConnection) {
        row.push(p.ipEnc ? decrypt(p.ipEnc, env.auditEncKey) : '', p.uaEnc ? decrypt(p.uaEnc, env.auditEncKey) : '');
      }
      rows.push(row);
    }
    return toCsv(rows);
  }

  /** Boletas para recuento manual: hash del recibo + selección, sin votante. */
  async ballotsCsv(electionId: string) {
    await this.assertClosed(electionId);
    const ballots = await this.ds.getRepository(Ballot).find({
      where: { electionId },
      order: { receiptHash: 'ASC' }, // orden por hash = orden aleatorio, no cronológico
      relations: { selections: { candidate: { position: true } } },
    });
    const rows: unknown[][] = [['recibo_hash', 'estado', 'cargo', 'candidato']];
    for (const b of ballots) {
      if (b.selections.length === 0) rows.push([b.receiptHash, b.status, '', '(en blanco)']);
      for (const s of b.selections) rows.push([b.receiptHash, b.status, s.candidate.position.name, s.candidate.name]);
    }
    return toCsv(rows);
  }
}
