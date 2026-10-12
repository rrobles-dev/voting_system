import { BadRequestException, Body, Controller, Get, Header, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/roles.guard';
import { VotersService } from '../voters/voters.service';
import { readTable } from './tabular';
import { parseCandidates, templates } from './formats';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Plantillas descargables y validación previa de archivos, usadas por el formulario
 * de nuevo proceso: el admin ve los errores ANTES de crear nada.
 */
@Controller('admin/templates')
@Roles('ADMIN')
export class TemplatesController {
  constructor(private voters: VotersService) {}

  @Get('padron.xlsx')
  @Header('Content-Type', XLSX)
  @Header('Content-Disposition', 'attachment; filename="plantilla-padron.xlsx"')
  async rollXlsx() {
    return new StreamableFile(await templates.rollXlsx());
  }

  @Get('padron.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="plantilla-padron.csv"')
  rollCsv() {
    return templates.rollCsv();
  }

  @Get('candidatos.xlsx')
  @Header('Content-Type', XLSX)
  @Header('Content-Disposition', 'attachment; filename="plantilla-candidatos.xlsx"')
  async candidatesXlsx() {
    return new StreamableFile(await templates.candidatesXlsx());
  }

  @Get('candidatos.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="plantilla-candidatos.csv"')
  candidatesCsv() {
    return templates.candidatesCsv();
  }

  /** Valida un padrón sin guardarlo: devuelve el resumen y todos los errores. */
  @Post('padron/validate')
  @UseInterceptors(upload)
  async validateRoll(@UploadedFile() file?: Express.Multer.File, @Body('refType') refType?: string) {
    if (!file) throw new BadRequestException('Adjunta el archivo en el campo "file"');
    const type = refType === 'RUT' ? 'RUT' : 'CODE';
    const { errors, summary } = await this.voters.validateRoll(file.buffer, file.originalname, type);
    return { ...summary, errors };
  }

  /** Lee candidatos agrupados por cargo, para rellenar el formulario antes de crear. */
  @Post('candidatos/parse')
  @UseInterceptors(upload)
  async parseCandidates(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Adjunta el archivo en el campo "file"');
    try {
      return parseCandidates(await readTable(file.buffer, file.originalname, 'Candidatos'));
    } catch (e) {
      throw new BadRequestException(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  }
}
