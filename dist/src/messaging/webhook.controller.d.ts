import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';
export declare class WebhookController {
    private configService;
    private prisma;
    private messagingService;
    private readonly logger;
    private readonly verifyToken;
    constructor(configService: ConfigService, prisma: PrismaService, messagingService: MessagingService);
    verifyWebhook(mode: string, token: string, challenge: string, res: Response): Response<any, Record<string, any>>;
    handleWebhook(body: any, res: Response): Promise<void>;
    private processWebhookPayload;
}
