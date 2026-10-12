import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/roles.guard';
import { VotersService } from './voters.service';

class AddVoterDto {
  @IsString() ref: string;
  @IsString() organization: string;
  @IsString() email: string;
  @IsOptional() @IsInt() @Min(1) weight?: number;
  @IsOptional() @IsBoolean() eligible?: boolean;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() confirmWarnings?: boolean;
}

class EmailDto {
  @IsString() email: string;
  @IsOptional() @IsString() reason?: string;
}

class EligibilityDto {
  @IsBoolean() eligible: boolean;
  @IsOptional() @IsString() reason?: string;
}

class ReasonDto {
  @IsOptional() @IsString() reason?: string;
}

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
    @Body('confirmWarnings') confirmWarnings?: string | boolean,
  ) {
    const confirm = confirmWarnings === true || confirmWarnings === 'true';
    if (file) return this.voters.importRoll(id, file.buffer, file.originalname, confirm);
    if (csvText) return this.voters.importRoll(id, Buffer.from(csvText, 'utf8'), 'padron.csv', confirm);
    throw new BadRequestException('Adjunta el padrón en el campo "file" (.xlsx o .csv)');
  }

  /** Agregar un votante. Con la votación abierta exige motivo y emite su código al instante. */
  @Post('voters')
  addVoter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddVoterDto) {
    return this.voters.addVoter(id, dto);
  }

  /** Habilitar o bloquear un votante. Con la votación abierta exige motivo. */
  @Patch('voters/:voterId/eligibility')
  setEligibility(@Param('id', ParseUUIDPipe) id: string, @Param('voterId', ParseUUIDPipe) voterId: string, @Body() dto: EligibilityDto) {
    return this.voters.setEligibility(id, voterId, dto.eligible, dto.reason);
  }

  /** Cambiar el correo: invalida el código anterior y, con la votación abierta, envía uno nuevo. */
  @Patch('voters/:voterId/email')
  changeEmail(@Param('id', ParseUUIDPipe) id: string, @Param('voterId', ParseUUIDPipe) voterId: string, @Body() dto: EmailDto) {
    return this.voters.changeEmail(id, voterId, dto.email, dto.reason);
  }

  /** Quitar del padrón a quien nunca votó (por ejemplo, un registro duplicado). */
  @Post('voters/:voterId/remove')
  removeVoter(@Param('id', ParseUUIDPipe) id: string, @Param('voterId', ParseUUIDPipe) voterId: string, @Body() dto: ReasonDto) {
    return this.voters.removeVoter(id, voterId, dto.reason);
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
