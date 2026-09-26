import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

export interface SendMailOptions {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private readonly templateCache = new Map<string, handlebars.TemplateDelegate>();
  private readonly defaultFrom: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com');
    const port = Number(this.configService.get<number>('SMTP_PORT', 465));
    const secure =
      this.configService.get<string>('SMTP_SECURE') === 'true' || port === 465;
    const user = this.configService.get<string>(
      'SMTP_USER',
      'moaazsaadawy.dev@gmail.com',
    );
    const pass =
      this.configService.get<string>('APP_PASSWORD') ||
      this.configService.get<string>('SMTP_PASS') ||
      this.configService.get<string>('SMTP_PASSWORD') ||
      '';

    this.defaultFrom =
      this.configService.get<string>('SMTP_FROM') ||
      '"skillHUB" <moaazsaadawy.dev@gmail.com>';

    this.logger.log(
      `Initializing SMTP Transporter: host=${host}, port=${port}, secure=${secure}, user=${user}`,
    );

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      ...(port === 587 ? { requireTLS: true } : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP transporter connection verified successfully.');
    } catch (error) {
      this.logger.warn(
        `SMTP transporter verification warning: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Resolves, reads, compiles, and caches Handlebars templates
   */
  private getTemplate(templateName: string): handlebars.TemplateDelegate {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    const candidatePaths = [
      path.join(__dirname, 'templates', `${templateName}.hbs`),
      path.join(__dirname, '../templates', `${templateName}.hbs`),
      path.join(__dirname, '../../templates', `${templateName}.hbs`),
      path.join(
        process.cwd(),
        'apps/notifications-service/src/templates',
        `${templateName}.hbs`,
      ),
      path.join(
        process.cwd(),
        'dist/apps/notifications-service/templates',
        `${templateName}.hbs`,
      ),
      path.join(
        process.cwd(),
        'dist/apps/notifications-service/apps/notifications-service/src/templates',
        `${templateName}.hbs`,
      ),
    ];

    let templateContent: string | null = null;
    let resolvedPath: string | null = null;

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        templateContent = fs.readFileSync(p, 'utf-8');
        resolvedPath = p;
        break;
      }
    }

    if (!templateContent) {
      throw new Error(
        `Handlebars template "${templateName}.hbs" not found in any candidate path: ${candidatePaths.join(
          ', ',
        )}`,
      );
    }

    this.logger.debug(
      `Compiled template "${templateName}" from: ${resolvedPath}`,
    );

    const compiled = handlebars.compile(templateContent);
    this.templateCache.set(templateName, compiled);
    return compiled;
  }

  /**
   * Sends an email by rendering a Handlebars template
   */
  async sendEmail(options: SendMailOptions): Promise<nodemailer.SentMessageInfo> {
    const { to, subject, template, context } = options;

    const compiledTemplate = this.getTemplate(template);
    const html = compiledTemplate({
      ...context,
      year: new Date().getFullYear(),
    });

    const mailOptions: nodemailer.SendMailOptions = {
      from: this.defaultFrom,
      to,
      subject,
      html,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `[NotificationsService] Verification email sent to ${to} (MessageId: ${info.messageId})`,
      );
      return info;
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${to}:`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Convenience helper to send verification email
   */
  async sendVerificationEmail(
    email: string,
    username: string,
    code: string,
  ): Promise<nodemailer.SentMessageInfo> {
    return this.sendEmail({
      to: email,
      subject: 'Verify your SkillHUB account',
      template: 'verification-email',
      context: {
        email,
        username,
        code,
      },
    });
  }
}
