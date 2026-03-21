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

    for (const entry of payload.entry || []) {
      const wabaId = entry.id;

      if (!wabaId) {
        this.logger.warn('No WABA ID in webhook entry');
        continue;
      }

      // Find organization by WABA ID
      let org: { id: string; name: string } | null = null;
      try {
        org = await this.prisma.organization.findFirst({
          where: { wabaId: String(wabaId) },
        });
      } catch (dbError) {
        this.logger.error(`Database error looking up org: ${dbError.message}`);
        continue;
      }

      if (!org) {
        this.logger.warn(`No organization found for WABA ID: ${wabaId}`);
        // Broadcast to all connected clients so the issue is visible in the monitor
        this.messagingService.emitOrphanWebhookEvent(payload, String(wabaId));
        continue;
      }

      // Emit the raw Facebook payload so the UI can see exactly what arrived
      this.messagingService.emitRawWebhookEvent(org.id, payload);

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

        // Process status updates — emit each one individually with full detail
        if (value.statuses) {
          for (const status of value.statuses) {
            // Emit raw status FIRST before any DB lookup can fail
            this.messagingService.emitRawStatusEvent(org.id, status);
            await this.messagingService.processStatusUpdate(org.id, status.id, status.status, status);
          }
        }
      }
    }
  }
}
