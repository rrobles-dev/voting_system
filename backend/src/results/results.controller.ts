import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';

@Controller('admin/elections/:id')
@Roles('ADMIN', 'AUDITOR')
export class ResultsController {
  constructor(private results: ResultsService, private audit: AuditService) {}

  @Get('results')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.results.results(id);
  }

  @Post('tally')
  @Roles('ADMIN')
  tally(@Param('id', ParseUUIDPipe) id: string) {
    return this.results.tally(id);
  }

  @Get('reports/results.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  resultsCsv(@Param('id', ParseUUIDPipe) id: string) {
    return this.results.resultsCsv(id);
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
  verify() {
    return this.audit.verifyChain();
  }
}
