import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { ConfigService } from '@nestjs/config';
export declare class WhatsappController {
    private whatsappService;
    private configService;
    constructor(whatsappService: WhatsappService, configService: ConfigService);
    connect(user: any): Promise<{
        error: string;
        url?: undefined;
    } | {
        url: string;
        error?: undefined;
    }>;
    callback(code: string, state: string, error: string, errorDescription: string, res: Response): Promise<void>;
    getStatus(user: any): Promise<{
        whatsappConnected: boolean;
        wabaId: string | null;
        phoneNumberId: string | null;
        phoneNumber: string | null;
    } | {
        connected: boolean;
    } | null>;
    getAccountDetails(user: any): Promise<any>;
    disconnect(user: any): Promise<{
        error: string;
        success?: undefined;
    } | {
        success: boolean;
        error?: undefined;
    }>;
    embeddedSignup(user: any, body: {
        code?: string;
        accessToken?: string;
    }): Promise<{
        success: boolean;
        phoneNumber: any;
        wabaId: any;
    } | {
        error: any;
    }>;
}
