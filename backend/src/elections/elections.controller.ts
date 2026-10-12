import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { ElectionStatus } from '../database/entities';
import { ElectionsService } from './elections.service';
import { CreateElectionDto } from './elections.dto';

@Controller('admin/elections')
@Roles('ADMIN', 'AUDITOR')
export class ElectionsController {
  constructor(private elections: ElectionsService) {}

  @Get()
  list() {
    return this.elections.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.elections.get(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateElectionDto) {
    return this.elections.create(dto);
  }

  /** Apertura/cierre manual. El scheduler también los hace automáticamente por fecha. */
  @Post(':id/open')
  @Roles('ADMIN')
  open(@Param('id', ParseUUIDPipe) id: string) {
    return this.elections.transition(id, ElectionStatus.OPEN, 'ADMIN');
  }

  @Post(':id/close')
  @Roles('ADMIN')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.elections.transition(id, ElectionStatus.CLOSED, 'ADMIN');
  }
}
