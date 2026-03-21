import { PrismaService } from '../prisma/prisma.service';
import { MessagingGateway } from './messaging.gateway';
import { ConfigService } from '@nestjs/config';
import { ChatStatus, SenderType } from '@prisma/client';
interface WhatsAppMessage {
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: {
        body: string;
    };
    image?: {
        id: string;
        caption?: string;
    };
    video?: {
        id: string;
        caption?: string;
    };
    audio?: {
        id: string;
    };
    document?: {
        id: string;
        filename?: string;
        caption?: string;
    };
    sticker?: {
        id: string;
    };
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
    };
    contacts?: any[];
    interactive?: any;
    button?: {
        text: string;
        payload: string;
    };
}
interface WhatsAppContact {
    profile: {
        name: string;
    };
    wa_id: string;
}
export declare class MessagingService {
    private prisma;
    private gateway;
    private configService;
    private readonly logger;
    private readonly facebookVersion;
    constructor(prisma: PrismaService, gateway: MessagingGateway, configService: ConfigService);
    processIncomingMessage(organizationId: string, message: WhatsAppMessage, contact: WhatsAppContact): Promise<{
        contact: {
            phone: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            organizationId: string;
            name: string | null;
            status: import("@prisma/client").$Enums.ChatStatus;
            waId: string;
            profilePicUrl: string | null;
            assignedToId: string | null;
            tags: string[];
            attributes: import("@prisma/client/runtime/client").JsonValue | null;
            lastMessageAt: Date | null;
        };
        message: {
            id: string;
            status: import("@prisma/client").$Enums.MessageStatus;
            waMessageId: string | null;
            content: string | null;
            type: import("@prisma/client").$Enums.MessageType;
            mediaUrl: string | null;
            mediaCaption: string | null;
            direction: import("@prisma/client").$Enums.MessageDirection;
            senderType: import("@prisma/client").$Enums.SenderType;
            senderId: string | null;
            statusUpdatedAt: Date | null;
            timestamp: Date;
            contactId: string;
        };
    }>;
    processStatusUpdate(waMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed'): Promise<void>;
    findOrCreateContact(organizationId: string, waId: string, name?: string): Promise<{
        phone: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        organizationId: string;
        name: string | null;
        status: import("@prisma/client").$Enums.ChatStatus;
        waId: string;
        profilePicUrl: string | null;
        assignedToId: string | null;
        tags: string[];
        attributes: import("@prisma/client/runtime/client").JsonValue | null;
        lastMessageAt: Date | null;
    }>;
    sendTextMessage(organizationId: string, contactId: string, text: string, senderId?: string, senderType?: SenderType): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.MessageStatus;
        waMessageId: string | null;
        content: string | null;
        type: import("@prisma/client").$Enums.MessageType;
        mediaUrl: string | null;
        mediaCaption: string | null;
        direction: import("@prisma/client").$Enums.MessageDirection;
        senderType: import("@prisma/client").$Enums.SenderType;
        senderId: string | null;
        statusUpdatedAt: Date | null;
        timestamp: Date;
        contactId: string;
    }>;
    getContacts(organizationId: string, status?: ChatStatus, search?: string, limit?: number, offset?: number): Promise<{
        contacts: {
            lastMessage: {
                id: string;
                status: import("@prisma/client").$Enums.MessageStatus;
                waMessageId: string | null;
                content: string | null;
                type: import("@prisma/client").$Enums.MessageType;
                mediaUrl: string | null;
                mediaCaption: string | null;
                direction: import("@prisma/client").$Enums.MessageDirection;
                senderType: import("@prisma/client").$Enums.SenderType;
                senderId: string | null;
                statusUpdatedAt: Date | null;
                timestamp: Date;
                contactId: string;
            };
            unreadCount: number;
            _count: {
                messages: number;
            };
            messages: {
                id: string;
                status: import("@prisma/client").$Enums.MessageStatus;
                waMessageId: string | null;
                content: string | null;
                type: import("@prisma/client").$Enums.MessageType;
                mediaUrl: string | null;
                mediaCaption: string | null;
                direction: import("@prisma/client").$Enums.MessageDirection;
                senderType: import("@prisma/client").$Enums.SenderType;
                senderId: string | null;
                statusUpdatedAt: Date | null;
                timestamp: Date;
                contactId: string;
            }[];
            phone: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            organizationId: string;
            name: string | null;
            status: import("@prisma/client").$Enums.ChatStatus;
            waId: string;
            profilePicUrl: string | null;
            assignedToId: string | null;
            tags: string[];
            attributes: import("@prisma/client/runtime/client").JsonValue | null;
            lastMessageAt: Date | null;
        }[];
        total: number;
    }>;
    getMessages(contactId: string, limit?: number, before?: string): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.MessageStatus;
        waMessageId: string | null;
        content: string | null;
        type: import("@prisma/client").$Enums.MessageType;
        mediaUrl: string | null;
        mediaCaption: string | null;
        direction: import("@prisma/client").$Enums.MessageDirection;
        senderType: import("@prisma/client").$Enums.SenderType;
        senderId: string | null;
        statusUpdatedAt: Date | null;
        timestamp: Date;
        contactId: string;
    }[]>;
    markAsRead(contactId: string): Promise<void>;
    interveneChat(contactId: string, agentId: string): Promise<{
        phone: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        organizationId: string;
        name: string | null;
        status: import("@prisma/client").$Enums.ChatStatus;
        waId: string;
        profilePicUrl: string | null;
        assignedToId: string | null;
        tags: string[];
        attributes: import("@prisma/client/runtime/client").JsonValue | null;
        lastMessageAt: Date | null;
    }>;
    resolveChat(contactId: string): Promise<{
        phone: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        organizationId: string;
        name: string | null;
        status: import("@prisma/client").$Enums.ChatStatus;
        waId: string;
        profilePicUrl: string | null;
        assignedToId: string | null;
        tags: string[];
        attributes: import("@prisma/client/runtime/client").JsonValue | null;
        lastMessageAt: Date | null;
    }>;
    getContactWithMessages(contactId: string, messageLimit?: number): Promise<({
        assignedTo: {
            fullName: string;
            id: string;
            avatar: string | null;
        } | null;
        messages: {
            id: string;
            status: import("@prisma/client").$Enums.MessageStatus;
            waMessageId: string | null;
            content: string | null;
            type: import("@prisma/client").$Enums.MessageType;
            mediaUrl: string | null;
            mediaCaption: string | null;
            direction: import("@prisma/client").$Enums.MessageDirection;
            senderType: import("@prisma/client").$Enums.SenderType;
            senderId: string | null;
            statusUpdatedAt: Date | null;
            timestamp: Date;
            contactId: string;
        }[];
    } & {
        phone: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        organizationId: string;
        name: string | null;
        status: import("@prisma/client").$Enums.ChatStatus;
        waId: string;
        profilePicUrl: string | null;
        assignedToId: string | null;
        tags: string[];
        attributes: import("@prisma/client/runtime/client").JsonValue | null;
        lastMessageAt: Date | null;
    }) | null>;
    createContact(organizationId: string, phone: string, name?: string): Promise<{
        phone: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        organizationId: string;
        name: string | null;
        status: import("@prisma/client").$Enums.ChatStatus;
        waId: string;
        profilePicUrl: string | null;
        assignedToId: string | null;
        tags: string[];
        attributes: import("@prisma/client/runtime/client").JsonValue | null;
        lastMessageAt: Date | null;
    }>;
    getMessageTemplates(organizationId: string): Promise<any>;
    getConnectionDebugInfo(organizationId: string): Promise<{
        organizationId: string;
        organizationName: string;
        whatsappConnected: boolean;
        hasPhoneNumberId: boolean;
        hasWabaId: boolean;
        phoneNumber: string | null;
        hasAccessToken: boolean;
        tokenPreview: string | null;
    } | {
        error: string;
    } | {
        apiTest: {
            success: boolean;
            error: any;
            errorCode: any;
            phoneNumberDetails?: undefined;
        };
        organizationId: string;
        organizationName: string;
        whatsappConnected: boolean;
        hasPhoneNumberId: boolean;
        hasWabaId: boolean;
        phoneNumber: string | null;
        hasAccessToken: boolean;
        tokenPreview: string | null;
        error?: undefined;
    } | {
        apiTest: {
            success: boolean;
            phoneNumberDetails: {
                id: any;
                displayPhoneNumber: any;
                verifiedName: any;
                qualityRating: any;
            };
            error?: undefined;
            errorCode?: undefined;
        };
        organizationId: string;
        organizationName: string;
        whatsappConnected: boolean;
        hasPhoneNumberId: boolean;
        hasWabaId: boolean;
        phoneNumber: string | null;
        hasAccessToken: boolean;
        tokenPreview: string | null;
        error?: undefined;
    } | {
        apiTest: {
            success: boolean;
            error: any;
            errorCode?: undefined;
            phoneNumberDetails?: undefined;
        };
        organizationId: string;
        organizationName: string;
        whatsappConnected: boolean;
        hasPhoneNumberId: boolean;
        hasWabaId: boolean;
        phoneNumber: string | null;
        hasAccessToken: boolean;
        tokenPreview: string | null;
        error?: undefined;
    }>;
    testWhatsAppConnection(organizationId: string, testPhone?: string): Promise<any>;
    sendTemplateMessage(organizationId: string, contactId: string, templateName: string, languageCode: string, components?: any[], senderId?: string): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.MessageStatus;
        waMessageId: string | null;
        content: string | null;
        type: import("@prisma/client").$Enums.MessageType;
        mediaUrl: string | null;
        mediaCaption: string | null;
        direction: import("@prisma/client").$Enums.MessageDirection;
        senderType: import("@prisma/client").$Enums.SenderType;
        senderId: string | null;
        statusUpdatedAt: Date | null;
        timestamp: Date;
        contactId: string;
    }>;
}
export {};
