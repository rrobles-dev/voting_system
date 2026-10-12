import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Acta, ActaKind, Election, ElectionStatus, Voter } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { ResultsService, LiveResults } from './results.service';
import { canonical, sha256 } from '../common/crypto';
import { MESSAGES } from '../common/messages';

type RankStatus = 'ELECTED' | 'TIED' | 'NOT_ELECTED';

export interface ActaSnapshot {
  election: { id: string; title: string; opensAt: string; closesAt: string };
  validBallots: number;
  annulledBallots: number;
  participation: { eligible: number; voted: number; percent: number };
  positions: {
    id: string;
    name: string;
    seats: number;
    tie: boolean;
    ranking: { candidateId: string; name: string; votes: number; status: RankStatus; byResolution?: boolean }[];
    resolution?: { winners: string[]; note: string; resolvedAt: string };
  }[];
}

const hashActa = (snapshot: ActaSnapshot, prevHash: string | null) => sha256((prevHash ?? '') + canonical(snapshot));
const hasPendingTies = (s: ActaSnapshot) => s.positions.some((p) => p.tie && !p.resolution);

/**
 * Actas oficiales.
 * - Publicar el escrutinio SIEMPRE congela el acta v1 (snapshot + hash en la cadena de auditoría).
 * - Un empate se resuelve fuera del sistema; aquí solo se registra el resultado en un acta complementaria.
 * - Notificar a los socios y habilitar la página pública son acciones manuales, bloqueadas
 *   mientras quede algún empate sin resolver: no se comunica un resultado que aún no es definitivo.
 */
@Injectable()
export class ActasService {
  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private mail: MailService,
    private results: ResultsService,
  ) {}

  private toSnapshot(r: LiveResults, election: Election, participation: ActaSnapshot['participation']): ActaSnapshot {
    return {
      election: {
        id: election.id, title: election.title,
        opensAt: election.opensAt.toISOString(), closesAt: election.closesAt.toISOString(),
      },
      validBallots: r.validBallots,
      annulledBallots: r.annulledBallots,
      participation,
      positions: r.positions.map((p) => ({ id: p.id, name: p.name, seats: p.seats, tie: p.tie, ranking: p.ranking })),
    };
  }

  private async participation(em: EntityManager, electionId: string) {
    const [{ eligible, voted }] = await em.query(
      `SELECT
         COUNT(*) FILTER (WHERE v.eligible) AS eligible,
         COUNT(*) FILTER (WHERE v.eligible AND EXISTS (
           SELECT 1 FROM participation p WHERE p."voterId" = v.id AND p.annulled = false)) AS voted
       FROM voter v WHERE v."electionId" = $1`,
      [electionId],
    );
    const e = Number(eligible), vo = Number(voted);
    return { eligible: e, voted: vo, percent: e ? Math.round((vo / e) * 1000) / 10 : 0 };
  }

  /** Publica el escrutinio: estado TALLIED + acta v1, todo en una transacción. */
  async publish(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (election.status !== ElectionStatus.CLOSED) throw new BadRequestException('Solo se publica una elección cerrada');

    const live = await this.results.liveResults(electionId);
    await this.ds.transaction(async (em) => {
      const snapshot = this.toSnapshot(live, election, await this.participation(em, electionId));
      const hash = hashActa(snapshot, null);
      await em.update(Election, { id: electionId }, { status: ElectionStatus.TALLIED });
      await em.save(em.create(Acta, {
        electionId, version: 1, kind: ActaKind.ESCRUTINIO, snapshot: snapshot as unknown as Record<string, unknown>,
        prevHash: null, hash, pendingTies: hasPendingTies(snapshot),
      }));
      await this.audit.log(em, electionId, 'ELECTION_TALLIED', 'ADMIN', { from: ElectionStatus.CLOSED, to: ElectionStatus.TALLIED });
      await this.audit.log(em, electionId, 'ACTA_ISSUED', 'ADMIN', { version: 1, hash, pendingTies: hasPendingTies(snapshot) });
    });
    return this.latest(electionId);
  }

  async list(electionId: string) {
    return this.ds.getRepository(Acta).find({ where: { electionId }, order: { version: 'ASC' } });
  }

  async latest(electionId: string) {
    const acta = await this.ds.getRepository(Acta).findOne({ where: { electionId }, order: { version: 'DESC' } });
    if (!acta) throw new NotFoundException('La elección aún no tiene acta');
    return acta;
  }

  /**
   * Registra la resolución de un empate decidida fuera del sistema (acuerdo entre candidatos,
   * sorteo según reglamento, etc.). Crea un acta complementaria encadenada a la anterior.
   */
  async resolveTie(electionId: string, positionId: string, winners: string[], note: string) {
    const current = await this.latest(electionId);
    const snapshot = structuredClone(current.snapshot) as unknown as ActaSnapshot;
    const position = snapshot.positions.find((p) => p.id === positionId);
    if (!position) throw new NotFoundException('Cargo no encontrado en el acta');
    if (!position.tie || position.resolution) throw new BadRequestException('Ese cargo no tiene un empate pendiente');

    const tied = position.ranking.filter((c) => c.status === 'TIED');
    const remaining = position.seats - position.ranking.filter((c) => c.status === 'ELECTED').length;
    if (new Set(winners).size !== winners.length) throw new BadRequestException('Hay candidatos repetidos');
    if (winners.some((id) => !tied.some((c) => c.candidateId === id))) {
      throw new BadRequestException('Solo se puede elegir entre los candidatos empatados');
    }
    if (winners.length !== remaining) {
      throw new BadRequestException(`Quedan ${remaining} cupo(s) por asignar: elige exactamente ${remaining}`);
    }

    position.ranking = position.ranking.map((c) => {
      if (c.status !== 'TIED') return c;
      return winners.includes(c.candidateId)
        ? { ...c, status: 'ELECTED' as const, byResolution: true }
        : { ...c, status: 'NOT_ELECTED' as const };
    });
    position.resolution = { winners, note: note.trim(), resolvedAt: new Date().toISOString() };

    const version = current.version + 1;
    const hash = hashActa(snapshot, current.hash);
    await this.ds.transaction(async (em) => {
      await em.save(em.create(Acta, {
        electionId, version, kind: ActaKind.RESOLUCION_EMPATE, snapshot: snapshot as unknown as Record<string, unknown>,
        prevHash: current.hash, hash, pendingTies: hasPendingTies(snapshot),
      }));
      await this.audit.log(em, electionId, 'TIE_RESOLVED', 'ADMIN', { version, positionId, winners, note: note.trim(), hash });
    });
    return this.latest(electionId);
  }

  /**
   * Verifica dos cosas:
   * 1. La cadena de actas está íntegra (cada hash cuadra con su contenido y con el anterior).
   * 2. Un recuento en vivo de las boletas coincide con los votos del acta v1.
   *    Si alguien alteró boletas después de publicar, aquí aparece la diferencia.
   */
  async verify(electionId: string) {
    const actas = await this.list(electionId);
    if (!actas.length) throw new NotFoundException('La elección aún no tiene acta');
    let prev: string | null = null;
    for (const a of actas) {
      const snap = a.snapshot as unknown as ActaSnapshot;
      if (a.prevHash !== prev || a.hash !== hashActa(snap, prev)) {
        return { chainOk: false, brokenAtVersion: a.version, recountMatches: null, differences: [] };
      }
      prev = a.hash;
    }

    const live = await this.results.liveResults(electionId);
    const official = actas[0].snapshot as unknown as ActaSnapshot;
    const differences: { position: string; candidate: string; acta: number; recount: number }[] = [];
    for (const p of official.positions) {
      const lp = live.positions.find((x) => x.id === p.id);
      for (const c of p.ranking) {
        const recount = lp?.ranking.find((x) => x.candidateId === c.candidateId)?.votes ?? 0;
        if (recount !== c.votes) differences.push({ position: p.name, candidate: c.name, acta: c.votes, recount });
      }
    }
    if (live.validBallots !== official.validBallots) {
      differences.push({ position: '(total)', candidate: 'Boletas válidas', acta: official.validBallots, recount: live.validBallots });
    }
    return { chainOk: true, recountMatches: differences.length === 0, differences, versions: actas.length };
  }

  private async assertDefinitive(electionId: string) {
    const acta = await this.latest(electionId);
    if (acta.pendingTies) {
      throw new ForbiddenException('Hay empates sin resolver: registra la resolución antes de comunicar resultados');
    }
    return acta;
  }

  /** Correo a todos los socios del padrón con el resultado oficial definitivo. Una sola vez. */
  async notifyMembers(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneByOrFail({ id: electionId });
    if (election.membersNotifiedAt) {
      throw new BadRequestException(`Los socios ya fueron notificados el ${election.membersNotifiedAt.toLocaleString('es-CL')}`);
    }
    const acta = await this.assertDefinitive(electionId);
    const snap = acta.snapshot as unknown as ActaSnapshot;
    const msg = MESSAGES.email.officialResults(snap, acta.version, acta.hash);
    const voters = await this.ds.getRepository(Voter).findBy({ electionId });
    const sent = await Promise.allSettled(voters.map((v) => this.mail.sendNotice(v.email, msg.subject, msg.body)));
    const ok = sent.filter((r) => r.status === 'fulfilled').length;
    // Si no salió ningún correo (SMTP caído), no se marca como notificado: debe poder reintentarse.
    if (voters.length > 0 && ok === 0) {
      throw new ServiceUnavailableException('No se pudo enviar ningún correo. Revisa el servidor de correo y reintenta.');
    }
    await this.ds.transaction(async (em) => {
      await em.update(Election, { id: electionId }, { membersNotifiedAt: new Date() });
      await this.audit.log(em, electionId, 'MEMBERS_NOTIFIED', 'ADMIN', { actaVersion: acta.version, recipients: voters.length, delivered: ok });
    });
    return { recipients: voters.length, delivered: ok };
  }

  async setPublic(electionId: string, enabled: boolean) {
    if (enabled) await this.assertDefinitive(electionId);
    await this.ds.transaction(async (em) => {
      await em.update(Election, { id: electionId }, { publicResults: enabled });
      await this.audit.log(em, electionId, enabled ? 'PUBLIC_RESULTS_ENABLED' : 'PUBLIC_RESULTS_DISABLED', 'ADMIN', {});
    });
    return { publicResults: enabled };
  }

  /** Datos para la página pública/insertable: solo lo que dice el acta oficial definitiva. */
  async publicResults(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election || !election.publicResults) throw new NotFoundException('Resultados no publicados');
    const acta = await this.assertDefinitive(electionId);
    const snap = acta.snapshot as unknown as ActaSnapshot;
    return {
      title: snap.election.title,
      closedAt: snap.election.closesAt,
      actaVersion: acta.version,
      actaHash: acta.hash,
      issuedAt: acta.createdAt,
      participation: snap.participation,
      positions: snap.positions.map((p) => ({
        name: p.name,
        seats: p.seats,
        elected: p.ranking.filter((c) => c.status === 'ELECTED').map((c) => ({ name: c.name, votes: c.votes })),
        others: p.ranking.filter((c) => c.status !== 'ELECTED').map((c) => ({ name: c.name, votes: c.votes })),
        resolutionNote: p.resolution?.note ?? null,
      })),
    };
  }

  /** Acta imprimible en HTML (se guarda como PDF desde el navegador). */
  async actaHtml(electionId: string, version?: number) {
    const actas = await this.list(electionId);
    const acta = version ? actas.find((a) => a.version === version) : actas[actas.length - 1];
    if (!acta) throw new NotFoundException('Acta no encontrada');
    const s = acta.snapshot as unknown as ActaSnapshot;
    const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
    const fmt = (iso: string | Date) => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' });
    const label: Record<RankStatus, string> = { ELECTED: 'Electo', TIED: 'Empate pendiente', NOT_ELECTED: 'No electo' };

    const positions = s.positions.map((p) => `
      <h2>${esc(p.name)} <small>(${p.seats} cupos)</small></h2>
      <table>
        <thead><tr><th>#</th><th>Candidato</th><th class="n">Votos</th><th>Resultado</th></tr></thead>
        <tbody>${p.ranking.map((c, i) => `
          <tr><td>${i + 1}</td><td>${esc(c.name)}</td><td class="n">${c.votes}</td>
          <td>${label[c.status]}${c.byResolution ? ' (por resolución de empate)' : ''}</td></tr>`).join('')}
        </tbody>
      </table>
      ${p.tie && !p.resolution ? '<p class="warn">Empate en el último cupo pendiente de resolución según reglamento.</p>' : ''}
      ${p.resolution ? `<p class="note"><strong>Resolución de empate (${fmt(p.resolution.resolvedAt)}):</strong> ${esc(p.resolution.note)}</p>` : ''}`).join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Acta v${acta.version} - ${esc(s.election.title)}</title>
<style>
  body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 24px;color:#111;line-height:1.5}
  h1{font-size:1.5rem;margin-bottom:0} h2{font-size:1.15rem;margin-top:32px}
  .meta{color:#444} table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left} .n{text-align:right}
  .warn{background:#fbf0dc;padding:8px 12px} .note{background:#eef3f0;padding:8px 12px}
  .hash{font-family:monospace;font-size:.8rem;word-break:break-all;color:#444}
  footer{margin-top:40px;border-top:1px solid #999;padding-top:12px;font-size:.9rem}
  .firmas{display:flex;gap:40px;margin-top:64px}.firmas div{flex:1;border-top:1px solid #333;padding-top:6px;text-align:center}
  @media print{body{margin:0}}
</style></head><body>
<h1>Acta de escrutinio${acta.kind === ActaKind.RESOLUCION_EMPATE ? ' (complementaria)' : ''}</h1>
<p class="meta"><strong>${esc(s.election.title)}</strong><br>
Votación entre el ${fmt(s.election.opensAt)} y el ${fmt(s.election.closesAt)}.<br>
Acta versión ${acta.version}, emitida el ${fmt(acta.createdAt)}.</p>
<p>Padrón habilitado: <strong>${s.participation.eligible}</strong> ·
Votaron: <strong>${s.participation.voted}</strong> (${s.participation.percent}%) ·
Boletas válidas: <strong>${s.validBallots}</strong> · Boletas anuladas: <strong>${s.annulledBallots}</strong></p>
${positions}
<footer>
  <p>Huella digital del acta (SHA-256):</p>
  <p class="hash">${acta.hash}</p>
  ${acta.prevHash ? `<p>Acta anterior:</p><p class="hash">${acta.prevHash}</p>` : ''}
  <div class="firmas"><div>Presidente comisión electoral</div><div>Secretario comisión electoral</div></div>
</footer></body></html>`;
  }
}
