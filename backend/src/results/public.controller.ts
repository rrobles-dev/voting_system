import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActasService } from './actas.service';

/**
 * API pública de resultados oficiales. Sin autenticación, de solo lectura,
 * y solo cuando el admin habilitó la publicación y no quedan empates pendientes.
 * CORS abierto: cualquier sitio (la web de la asociación) puede consumir este JSON
 * con su propio diseño, o usar la página insertable del frontend.
 */
@Controller('public/elections')
export class PublicResultsController {
  constructor(private actas: ActasService) {}

  @Get(':id/results')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=60')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  results(@Param('id', ParseUUIDPipe) id: string) {
    return this.actas.publicResults(id);
  }
}
