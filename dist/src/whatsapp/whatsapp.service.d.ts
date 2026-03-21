import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
interface EmbeddedSignupData {
    phone_number_id: string;
    waba_id: string;
    display_phone_number?: string;
}
export declare class WhatsappService {
    private prisma;
    private configService;
    private readonly logger;
    private readonly appId;
    private readonly appSecret;
    private readonly redirectUri;
    constructor(prisma: PrismaService, configService: ConfigService);
    getOAuthUrl(state: string): string;
    exchangeCodeForToken(code: string): Promise<string>;
    getLongLivedToken(shortLivedToken: string): Promise<string>;
    getWhatsAppBusinessAccounts(accessToken: string): Promise<any[]>;
    getPhoneNumbers(wabaId: string, accessToken: string): Promise<any[]>;
    connectWhatsApp(organizationId: string, accessToken: string, wabaId: string, phoneNumberId: string, phoneNumber: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        slug: string;
        logo: string | null;
        timezone: string;
        whatsappConnected: boolean;
        facebookAccessToken: string | null;
        facebookUserId: string | null;
        wabaId: string | null;
        phoneNumberId: string | null;
        phoneNumber: string | null;
        webhookVerifyToken: string | null;
    }>;
    handleCallback(code: string, organizationId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        slug: string;
        logo: string | null;
        timezone: string;
        whatsappConnected: boolean;
        facebookAccessToken: string | null;
        facebookUserId: string | null;
        wabaId: string | null;
        phoneNumberId: string | null;
        phoneNumber: string | null;
        webhookVerifyToken: string | null;
    }>;
    disconnectWhatsApp(organizationId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        slug: string;
        logo: string | null;
        timezone: string;
        whatsappConnected: boolean;
        facebookAccessToken: string | null;
        facebookUserId: string | null;
        wabaId: string | null;
        phoneNumberId: string | null;
        phoneNumber: string | null;
        webhookVerifyToken: string | null;
    }>;
    getConnectionStatus(organizationId: string): Promise<{
        whatsappConnected: boolean;
        wabaId: string | null;
        phoneNumberId: string | null;
        phoneNumber: string | null;
    } | null>;
    getAccountDetails(organizationId: string): Promise<any>;
    handleEmbeddedSignup(organizationId: string, code?: string, providedAccessToken?: string): Promise<{
        success: boolean;
        phoneNumber: any;
        wabaId: any;
    }>;
    processEmbeddedSignupSession(organizationId: string, accessToken: string, sessionInfo: EmbeddedSignupData): Promise<{
        success: boolean;
        phoneNumber: any;
        wabaId: string;
    }>;
}
export {};
