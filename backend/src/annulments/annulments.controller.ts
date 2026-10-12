import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsString, IsUUID, MinLength } from 'class-validator';
import { Roles } from '../auth/roles.guard';
import { AnnulmentsService } from './annulments.service';

class RequestAnnulmentDto {
  @IsUUID() voterId: string;
  @IsString() receipt: string;
  @IsString() @MinLength(10) reason: string;
}

@Controller('admin/elections/:id/annulments')
export class AnnulmentsController {
  constructor(private annulments: AnnulmentsService) {}

  @Get()
  @Roles('ADMIN', 'AUDITOR')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.annulments.list(id);
  }

  @Post()
  @Roles('ADMIN')
  request(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestAnnulmentDto) {
    return this.annulments.request(id, dto.voterId, dto.receipt, dto.reason);
  }

  @Post(':annulmentId/approve')
  @Roles('AUDITOR')
  approve(@Param('id', ParseUUIDPipe) id: string, @Param('annulmentId', ParseUUIDPipe) aid: string) {
    return this.annulments.resolve(id, aid, true);
  }

  @Post(':annulmentId/reject')
  @Roles('AUDITOR')
  reject(@Param('id', ParseUUIDPipe) id: string, @Param('annulmentId', ParseUUIDPipe) aid: string) {
    return this.annulments.resolve(id, aid, false);
  }
}
