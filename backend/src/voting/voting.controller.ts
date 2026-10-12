import { Body, Controller, Get, Headers, Ip, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsString, Length } from 'class-validator';
import { VotingService } from './voting.service';
import { env } from '../common/env';

class CodeDto {
  @IsString() @Length(6, 16) code: string;
}

class BallotDto extends CodeDto {
  @IsObject() selections: Record<string, string[]>;
}

/**
 * Endpoints públicos del votante. Throttle = rate limiting por IP, para impedir
 * probar códigos por fuerza bruta. El límite es configurable (VOTING_RATE_LIMIT)
 * porque varios votantes pueden compartir IP (misma oficina, asamblea presencial).
 * Aun así, adivinar un código de 56^9 combinaciones a 30 intentos/minuto tomaría
 * millones de años.
 */
const VOTE_LIMIT = { default: { limit: env.votingRateLimit, ttl: 60_000 } };
@Controller('voting')
export class VotingController {
  constructor(private voting: VotingService) {}

  @Post('session')
  @Throttle(VOTE_LIMIT)
  session(@Body() dto: CodeDto) {
    return this.voting.startSession(dto.code);
  }

  @Post('ballot')
  @Throttle(VOTE_LIMIT)
  cast(@Body() dto: BallotDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.voting.castBallot({ code: dto.code, selections: dto.selections, ip, userAgent: ua });
  }

  @Get('receipt/:receipt')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Param('receipt') receipt: string) {
    return this.voting.verifyReceipt(receipt);
  }
}
