import { Body, Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsBoolean, IsString, IsUUID, MinLength } from 'class-validator';
import { Roles } from '../auth/roles.guard';
import { AuditService } from '../audit/audit.service';
import { ElectionStatus } from '../database/entities';
import { ElectionsService } from '../elections/elections.service';
import { ResultsService } from './results.service';
import { ActasService } from './actas.service';

class ResolveTieDto {
  @IsUUID() positionId: string;
  @IsArray() @IsUUID('all', { each: true }) winners: string[];
  @IsString() @MinLength(10) note: string;
}

class PublicToggleDto {
  @IsBoolean() enabled: boolean;
}

@Controller('admin/elections/:id')
@Roles('ADMIN', 'AUDITOR')
export class ResultsController {
  constructor(
    private results: ResultsService,
    private actas: ActasService,
    private elections: ElectionsService,
    private audit: AuditService,
  ) {}

  /**
   * Cerrada → conteo preliminar en vivo. Escrutada → el acta oficial vigente.
   * La UI muestra lo mismo, pero el origen del dato cambia y se informa en "source".
   */
  @Get('results')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const election = await this.elections.get(id);
    if (election.status !== ElectionStatus.TALLIED) {
      return { source: 'PRELIMINARY', ...(await this.results.liveResults(id)) };
    }
    const acta = await this.actas.latest(id);
    return {
      source: 'ACTA',
      acta: { version: acta.version, kind: acta.kind, hash: acta.hash, pendingTies: acta.pendingTies, createdAt: acta.createdAt },
      publication: { membersNotifiedAt: election.membersNotifiedAt, publicResults: election.publicResults },
      ...acta.snapshot,
    };
  }

  /** Publica el escrutinio: congela el acta v1 y la registra en la cadena de auditoría. */
  @Post('tally')
  @Roles('ADMIN')
  async tally(@Param('id', ParseUUIDPipe) id: string) {
    const acta = await this.actas.publish(id);
    return { version: acta.version, hash: acta.hash, pendingTies: acta.pendingTies };
  }

  @Post('ties/resolve')
  @Roles('ADMIN')
  async resolveTie(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveTieDto) {
    const acta = await this.actas.resolveTie(id, dto.positionId, dto.winners, dto.note);
    return { version: acta.version, hash: acta.hash, pendingTies: acta.pendingTies };
  }

  @Get('actas')
  async listActas(@Param('id', ParseUUIDPipe) id: string) {
    const list = await this.actas.list(id);
    return list.map((a) => ({ version: a.version, kind: a.kind, hash: a.hash, prevHash: a.prevHash, pendingTies: a.pendingTies, createdAt: a.createdAt }));
  }

  @Get('actas/verify')
  verifyActas(@Param('id', ParseUUIDPipe) id: string) {
    return this.actas.verify(id);
  }

  @Get('actas/:version/acta.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  actaHtml(@Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number) {
    return this.actas.actaHtml(id, version);
  }

  @Post('notify-members')
  @Roles('ADMIN')
  notify(@Param('id', ParseUUIDPipe) id: string) {
    return this.actas.notifyMembers(id);
  }

  @Post('public-results')
  @Roles('ADMIN')
  setPublic(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicToggleDto) {
    return this.actas.setPublic(id, dto.enabled);
  }

  @Get('reports/results.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async resultsCsv(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.get(id);
    return this.results.resultsCsv(data as Parameters<ResultsService['resultsCsv']>[0]);
  }

  @Get('reports/ballots.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  ballotsCsv(@Param('id', ParseUUIDPipe) id: string) {
    return this.results.ballotsCsv(id);
  }

  /** ?reason=... obligatorio para el Auditor (incluye IP y user-agent). */
  @Get('reports/participation.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  participationCsv(@Param('id', ParseUUIDPipe) id: string, @Req() req: { role: string }, @Query('reason') reason?: string) {
    return this.results.participationCsv(id, req.role, reason);
  }

  @Get('audit')
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.audit.list(id);
  }

  @Get('audit/verify')
  verify(@Param('id', ParseUUIDPipe) _id: string) {
    return this.audit.verifyChain();
  }
}
