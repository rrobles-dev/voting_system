import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/roles.guard';
import { VotersService } from './voters.service';

@Controller('admin/elections/:id')
@Roles('ADMIN')
export class VotersController {
  constructor(private voters: VotersService) {}

  /**
   * Padrón como archivo Excel (.xlsx) o CSV (separador , o ;) en el campo "file".
   * Se mantiene { csv } en JSON por compatibilidad con scripts y tests.
   */
  @Post('voters/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('csv') csvText?: string,
  ) {
    if (file) return this.voters.importRoll(id, file.buffer, file.originalname);
    if (csvText) return this.voters.importRoll(id, Buffer.from(csvText, 'utf8'), 'padron.csv');
    throw new BadRequestException('Adjunta el padrón en el campo "file" (.xlsx o .csv)');
  }

  @Post('codes/issue')
  issue(@Param('id', ParseUUIDPipe) id: string) {
    return this.voters.issueCodes(id);
  }

  /** Código perdido: invalida el anterior y emite uno nuevo para un votante. */
  @Post('voters/:voterId/reissue')
  reissue(@Param('id', ParseUUIDPipe) id: string, @Param('voterId', ParseUUIDPipe) voterId: string) {
    return this.voters.issueCodes(id, voterId);
  }

  @Get('participation')
  @Roles('ADMIN', 'AUDITOR')
  participation(@Param('id', ParseUUIDPipe) id: string) {
    return this.voters.participation(id);
  }

  @Post('reminders')
  reminders(@Param('id', ParseUUIDPipe) id: string) {
    return this.voters.sendReminders(id);
  }
}
