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

  /** Acepta el CSV como archivo (multipart) o como texto en { csv }. */
  @Post('voters/import')
  @UseInterceptors(FileInterceptor('file'))
  import(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('csv') csvText?: string,
  ) {
    const csv = file?.buffer.toString('utf8') ?? csvText;
    if (!csv) throw new BadRequestException('Envía el CSV como archivo "file" o en el campo "csv"');
    return this.voters.importCsv(id, csv);
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
