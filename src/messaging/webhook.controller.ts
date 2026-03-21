import { Controller, Get, Post, Query, Body, Res, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly verifyToken: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private messagingService: MessagingService,
  ) {
    this.verifyToken = this.configService.get<string>('WEBHOOK_VERIFY_TOKEN') || 'whatflow_webhook_token';
  }

  /**
   * Webhook verification (GET request from Meta)
   * Meta sends this to verify your webhook endpoint
   */
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Webhook verification: mode=${mode}, token=${token}`);

    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Webhook verified successfully');
      return res.status(200).send(challenge);
    }

    this.logger.warn('Webhook verification failed');
    return res.status(403).send('Forbidden');
  }

  /**
   * Webhook events (POST request from Meta)
   * Receives messages, status updates, etc.
   */
  @Post()
  async handleWebhook(@Body() body: any, @Res() res: Response) {
    this.logger.log('=== WEBHOOK RECEIVED ===');
    this.logger.log(`Payload: ${JSON.stringify(body).substring(0, 500)}`);

    // Always respond quickly to Meta
    res.status(200).send('EVENT_RECEIVED');

    try {
      // Process the webhook payload
      await this.processWebhookPayload(body);
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`, error.stack);
    }
  }

  private async processWebhookPayload(payload: any) {
    // Validate it's a WhatsApp webhook
    if (payload.object !== 'whatsapp_business_account') {
      this.logger.log(`Ignoring non-WhatsApp webhook: ${payload.object}`);
      return;
    }

    // Process each entry
    for (const entry of payload.entry || []) {
      const wabaId = entry.id; // WhatsApp Business Account ID

      // Find organization by WABA ID
      const org = await this.prisma.organization.findFirst({
        where: { wabaId },
      });

      if (!org) {
        this.logger.warn(`No organization found for WABA ID: ${wabaId}`);
        continue;
      }

      // Process changes
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Process incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            const contact = value.contacts?.find((c: any) => c.wa_id === message.from);

            await this.messagingService.processIncomingMessage(
              org.id,
              message,
              contact || { wa_id: message.from, profile: { name: message.from } },
            );
          }
        }

        // Process status updates
        if (value.statuses) {
          for (const status of value.statuses) {
            await this.messagingService.processStatusUpdate(
              status.id,
              status.status,
            );
          }
        }
      }
    }
  }
}
