import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { env } from '../common/env';
import { MESSAGES } from '../common/messages';

/**
 * En local apunta a Mailpit (captura todo, no envía nada real).
 * En producción se cambia SMTP_HOST por un proveedor (SES, SendGrid) sin tocar código.
 */
@Injectable()
export class MailService {
  private logger = new Logger(MailService.name);
  private transport = nodemailer.createTransport({ host: env.smtpHost, port: env.smtpPort, secure: false });

  private async send(to: string, subject: string, text: string) {
    try {
      await this.transport.sendMail({ from: env.mailFrom, to, subject, text });
    } catch (e) {
      // Un correo fallido no debe tumbar la votación: se registra y se reintenta reemitiendo el código.
      this.logger.error(`No se pudo enviar correo a ${to}: ${(e as Error).message}`);
      throw e;
    }
  }

  sendCode(to: string, org: string, electionTitle: string, code: string, w: { closesAt: Date; autoClose: boolean }) {
    const m = MESSAGES.email.code;
    return this.send(to, m.subject(electionTitle), m.body(org, electionTitle, code, w, env.publicUrl));
  }

  /** Sin la selección: el correo puede quedar en una bandeja compartida. Solo el recibo. */
  sendConfirmation(to: string, electionTitle: string, receipt: string, votedAt: Date) {
    const m = MESSAGES.email.confirmation;
    return this.send(to, m.subject(electionTitle), m.body(electionTitle, receipt, votedAt));
  }

  sendNotice(to: string, subject: string, body: string) {
    return this.send(to, subject, body);
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
