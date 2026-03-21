import { MessagingService } from './messaging.service';
export declare class MessagingController {
    private messagingService;
    constructor(messagingService: MessagingService);
    getContacts(user: any, status?: string, search?: string, limit?: string, offset?: string): Promise<{
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
    getContact(user: any, contactId: string, messageLimit?: string): Promise<({
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
    getMessages(contactId: string, limit?: string, before?: string): Promise<{
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
        hasMore: boolean;
    }>;
    sendMessage(user: any, body: {
        contactId: string;
        text: string;
    }): Promise<{
        success: boolean;
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
        error?: undefined;
    } | {
        success: boolean;
        error: any;
        message?: undefined;
    }>;
    getDebugStatus(user: any): Promise<{
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
    }>;
    testSend(user: any, body: {
        phone: string;
    }): Promise<any>;
    intervene(user: any, contactId: string): Promise<{
        success: boolean;
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
        error?: undefined;
    } | {
        error: any;
        success?: undefined;
        contact?: undefined;
    }>;
    resolve(contactId: string): Promise<{
        success: boolean;
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
        error?: undefined;
    } | {
        error: any;
        success?: undefined;
        contact?: undefined;
    }>;
    markAsRead(contactId: string): Promise<{
        success: boolean;
    }>;
    createContact(user: any, body: {
        phone: string;
        name?: string;
    }): Promise<{
        success: boolean;
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
        error?: undefined;
    } | {
        error: any;
        success?: undefined;
        contact?: undefined;
    }>;
    sendTemplate(user: any, body: {
        contactId: string;
        templateName: string;
        languageCode?: string;
        components?: any[];
    }): Promise<{
        success: boolean;
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
        error?: undefined;
    } | {
        error: any;
        success?: undefined;
        message?: undefined;
    }>;
    getTemplates(user: any): Promise<{
        templates: any;
        error?: undefined;
    } | {
        error: any;
        templates: never[];
    }>;
}
