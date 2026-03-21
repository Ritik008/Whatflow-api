"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MessagingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const messaging_gateway_1 = require("./messaging.gateway");
const client_1 = require("@prisma/client");
let MessagingService = MessagingService_1 = class MessagingService {
    prisma;
    gateway;
    logger = new common_1.Logger(MessagingService_1.name);
    constructor(prisma, gateway) {
        this.prisma = prisma;
        this.gateway = gateway;
    }
    async processIncomingMessage(organizationId, message, contact) {
        this.logger.log(`Processing message from ${contact.wa_id}: ${message.type}`);
        const dbContact = await this.findOrCreateContact(organizationId, contact.wa_id, contact.profile?.name);
        let content = null;
        let mediaUrl = null;
        let mediaCaption = null;
        let messageType = client_1.MessageType.TEXT;
        switch (message.type) {
            case 'text':
                content = message.text?.body || '';
                messageType = client_1.MessageType.TEXT;
                break;
            case 'image':
                messageType = client_1.MessageType.IMAGE;
                mediaCaption = message.image?.caption ?? null;
                content = '[Image]';
                break;
            case 'video':
                messageType = client_1.MessageType.VIDEO;
                mediaCaption = message.video?.caption ?? null;
                content = '[Video]';
                break;
            case 'audio':
                messageType = client_1.MessageType.AUDIO;
                content = '[Audio]';
                break;
            case 'document':
                messageType = client_1.MessageType.DOCUMENT;
                mediaCaption = message.document?.caption ?? null;
                content = `[Document: ${message.document?.filename || 'file'}]`;
                break;
            case 'sticker':
                messageType = client_1.MessageType.STICKER;
                content = '[Sticker]';
                break;
            case 'location':
                messageType = client_1.MessageType.LOCATION;
                content = `[Location: ${message.location?.name || message.location?.address || 'Location'}]`;
                break;
            case 'contacts':
                messageType = client_1.MessageType.CONTACTS;
                content = '[Contact]';
                break;
            case 'interactive':
                messageType = client_1.MessageType.INTERACTIVE;
                content = message.interactive?.button_reply?.title ||
                    message.interactive?.list_reply?.title ||
                    '[Interactive]';
                break;
            case 'button':
                messageType = client_1.MessageType.TEXT;
                content = message.button?.text || '[Button]';
                break;
            default:
                content = `[${message.type}]`;
        }
        const dbMessage = await this.prisma.message.create({
            data: {
                contactId: dbContact.id,
                waMessageId: message.id,
                content,
                type: messageType,
                mediaUrl,
                mediaCaption,
                direction: client_1.MessageDirection.INBOUND,
                senderType: client_1.SenderType.USER,
                status: client_1.MessageStatus.DELIVERED,
                timestamp: new Date(parseInt(message.timestamp) * 1000),
            },
        });
        await this.prisma.contact.update({
            where: { id: dbContact.id },
            data: { lastMessageAt: new Date() },
        });
        this.gateway.emitNewMessage(organizationId, dbMessage);
        this.gateway.emitContactUpdate(organizationId, dbContact);
        return { contact: dbContact, message: dbMessage };
    }
    async processStatusUpdate(waMessageId, status) {
        const statusMap = {
            sent: client_1.MessageStatus.SENT,
            delivered: client_1.MessageStatus.DELIVERED,
            read: client_1.MessageStatus.READ,
            failed: client_1.MessageStatus.FAILED,
        };
        const dbStatus = statusMap[status];
        if (!dbStatus)
            return;
        await this.prisma.message.updateMany({
            where: { waMessageId },
            data: {
                status: dbStatus,
                statusUpdatedAt: new Date(),
            },
        });
        const message = await this.prisma.message.findUnique({
            where: { waMessageId },
            include: { contact: { select: { organizationId: true } } },
        });
        if (message) {
            this.gateway.emitStatusUpdate(message.contact.organizationId, {
                waMessageId,
                status: dbStatus,
            });
        }
        this.logger.log(`Updated status for ${waMessageId}: ${status}`);
    }
    async findOrCreateContact(organizationId, waId, name) {
        let contact = await this.prisma.contact.findUnique({
            where: {
                organizationId_waId: {
                    organizationId,
                    waId,
                },
            },
        });
        if (!contact) {
            const phone = '+' + waId;
            contact = await this.prisma.contact.create({
                data: {
                    organizationId,
                    waId,
                    phone,
                    name: name || phone,
                    status: client_1.ChatStatus.ACTIVE,
                },
            });
            this.logger.log(`Created new contact: ${contact.id}`);
        }
        else if (name && contact.name !== name) {
            contact = await this.prisma.contact.update({
                where: { id: contact.id },
                data: { name },
            });
        }
        return contact;
    }
    async sendTextMessage(organizationId, contactId, text, senderId, senderType = client_1.SenderType.AGENT) {
        this.logger.log(`Attempting to send message to contact ${contactId}`);
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                phoneNumberId: true,
                facebookAccessToken: true,
                whatsappConnected: true,
            },
        });
        this.logger.log(`Organization status: connected=${org?.whatsappConnected}, phoneNumberId=${org?.phoneNumberId ? 'set' : 'missing'}, token=${org?.facebookAccessToken ? 'set' : 'missing'}`);
        if (!org?.whatsappConnected) {
            throw new common_1.BadRequestException('WhatsApp is not connected. Please connect your WhatsApp Business account first.');
        }
        if (!org.phoneNumberId) {
            throw new common_1.BadRequestException('WhatsApp phone number not configured. Please reconnect your WhatsApp Business account.');
        }
        if (!org.facebookAccessToken) {
            throw new common_1.BadRequestException('WhatsApp access token missing. Please reconnect your WhatsApp Business account.');
        }
        const contact = await this.prisma.contact.findUnique({
            where: { id: contactId },
        });
        if (!contact) {
            throw new common_1.BadRequestException('Contact not found');
        }
        const url = `https://graph.facebook.com/v20.0/${org.phoneNumberId}/messages`;
        this.logger.log(`Sending message to WhatsApp API: ${url}`);
        this.logger.log(`Recipient waId: ${contact.waId}`);
        const requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: contact.waId,
            type: 'text',
            text: { body: text },
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${org.facebookAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
        const data = await response.json();
        this.logger.log(`WhatsApp API Response: ${JSON.stringify(data)}`);
        if (data.error) {
            this.logger.error(`Failed to send message: ${JSON.stringify(data.error)}`);
            const errorCode = data.error.code;
            let errorMessage = data.error.message;
            if (errorCode === 133010 || data.error.message.includes('not registered')) {
                errorMessage = 'This phone number is not registered on WhatsApp';
            }
            else if (errorCode === 131047) {
                errorMessage = 'Re-engagement message required. The 24-hour window has expired. Use a template message instead.';
            }
            throw new common_1.BadRequestException(errorMessage);
        }
        const message = await this.prisma.message.create({
            data: {
                contactId,
                waMessageId: data.messages?.[0]?.id,
                content: text,
                type: client_1.MessageType.TEXT,
                direction: client_1.MessageDirection.OUTBOUND,
                senderType,
                senderId,
                status: client_1.MessageStatus.SENT,
                timestamp: new Date(),
            },
        });
        await this.prisma.contact.update({
            where: { id: contactId },
            data: { lastMessageAt: new Date() },
        });
        this.logger.log(`Message sent: ${message.id}`);
        this.gateway.emitNewMessage(organizationId, message);
        this.gateway.emitContactUpdate(organizationId, { id: contactId, lastMessageAt: new Date() });
        return message;
    }
    async getContacts(organizationId, status, search, limit = 50, offset = 0) {
        const where = { organizationId };
        if (status) {
            where.status = status;
        }
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
            ];
        }
        const [contacts, total] = await Promise.all([
            this.prisma.contact.findMany({
                where,
                include: {
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                    },
                    _count: {
                        select: {
                            messages: {
                                where: {
                                    direction: client_1.MessageDirection.INBOUND,
                                    status: { not: client_1.MessageStatus.READ },
                                },
                            },
                        },
                    },
                },
                orderBy: { lastMessageAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            this.prisma.contact.count({ where }),
        ]);
        return {
            contacts: contacts.map((c) => ({
                ...c,
                lastMessage: c.messages[0] || null,
                unreadCount: c._count.messages,
            })),
            total,
        };
    }
    async getMessages(contactId, limit = 50, before) {
        const where = { contactId };
        if (before) {
            const beforeMessage = await this.prisma.message.findUnique({
                where: { id: before },
            });
            if (beforeMessage) {
                where.timestamp = { lt: beforeMessage.timestamp };
            }
        }
        const messages = await this.prisma.message.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
        return messages.reverse();
    }
    async markAsRead(contactId) {
        await this.prisma.message.updateMany({
            where: {
                contactId,
                direction: client_1.MessageDirection.INBOUND,
                status: { not: client_1.MessageStatus.READ },
            },
            data: { status: client_1.MessageStatus.READ },
        });
    }
    async interveneChat(contactId, agentId) {
        return this.prisma.contact.update({
            where: { id: contactId },
            data: {
                status: client_1.ChatStatus.INTERVENED,
                assignedToId: agentId,
            },
        });
    }
    async resolveChat(contactId) {
        return this.prisma.contact.update({
            where: { id: contactId },
            data: {
                status: client_1.ChatStatus.RESOLVED,
                assignedToId: null,
            },
        });
    }
    async getContactWithMessages(contactId, messageLimit = 50) {
        const contact = await this.prisma.contact.findUnique({
            where: { id: contactId },
            include: {
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: messageLimit,
                },
                assignedTo: {
                    select: { id: true, fullName: true, avatar: true },
                },
            },
        });
        if (contact) {
            contact.messages = contact.messages.reverse();
        }
        return contact;
    }
    async createContact(organizationId, phone, name) {
        const waId = phone.replace(/[\s\-\+]/g, '');
        const displayPhone = phone.startsWith('+') ? phone : `+${phone}`;
        const existing = await this.prisma.contact.findUnique({
            where: {
                organizationId_waId: {
                    organizationId,
                    waId,
                },
            },
        });
        if (existing) {
            return existing;
        }
        const contact = await this.prisma.contact.create({
            data: {
                organizationId,
                waId,
                phone: displayPhone,
                name: name || displayPhone,
                status: client_1.ChatStatus.ACTIVE,
            },
        });
        this.logger.log(`Created contact manually: ${contact.id}`);
        return contact;
    }
    async getMessageTemplates(organizationId) {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                wabaId: true,
                facebookAccessToken: true,
                whatsappConnected: true,
            },
        });
        if (!org?.whatsappConnected || !org.wabaId || !org.facebookAccessToken) {
            throw new common_1.BadRequestException('WhatsApp not connected');
        }
        const url = `https://graph.facebook.com/v20.0/${org.wabaId}/message_templates?status=APPROVED`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${org.facebookAccessToken}`,
            },
        });
        const data = await response.json();
        if (data.error) {
            this.logger.error(`Failed to fetch templates: ${data.error.message}`);
            throw new common_1.BadRequestException(data.error.message);
        }
        return data.data || [];
    }
    async getConnectionDebugInfo(organizationId) {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                id: true,
                name: true,
                whatsappConnected: true,
                phoneNumberId: true,
                wabaId: true,
                phoneNumber: true,
                facebookAccessToken: true,
            },
        });
        if (!org) {
            return { error: 'Organization not found' };
        }
        const status = {
            organizationId: org.id,
            organizationName: org.name,
            whatsappConnected: org.whatsappConnected,
            hasPhoneNumberId: !!org.phoneNumberId,
            hasWabaId: !!org.wabaId,
            phoneNumber: org.phoneNumber,
            hasAccessToken: !!org.facebookAccessToken,
            tokenPreview: org.facebookAccessToken ? `${org.facebookAccessToken.substring(0, 20)}...` : null,
        };
        if (org.whatsappConnected && org.facebookAccessToken && org.phoneNumberId) {
            try {
                const testUrl = `https://graph.facebook.com/v20.0/${org.phoneNumberId}?access_token=${org.facebookAccessToken}`;
                const response = await fetch(testUrl);
                const data = await response.json();
                if (data.error) {
                    return {
                        ...status,
                        apiTest: {
                            success: false,
                            error: data.error.message,
                            errorCode: data.error.code,
                        },
                    };
                }
                return {
                    ...status,
                    apiTest: {
                        success: true,
                        phoneNumberDetails: {
                            id: data.id,
                            displayPhoneNumber: data.display_phone_number,
                            verifiedName: data.verified_name,
                            qualityRating: data.quality_rating,
                        },
                    },
                };
            }
            catch (error) {
                return {
                    ...status,
                    apiTest: {
                        success: false,
                        error: error.message,
                    },
                };
            }
        }
        return status;
    }
    async sendTemplateMessage(organizationId, contactId, templateName, languageCode, components, senderId) {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                phoneNumberId: true,
                facebookAccessToken: true,
                whatsappConnected: true,
            },
        });
        if (!org?.whatsappConnected || !org.phoneNumberId || !org.facebookAccessToken) {
            throw new common_1.BadRequestException('WhatsApp not connected');
        }
        const contact = await this.prisma.contact.findUnique({
            where: { id: contactId },
        });
        if (!contact) {
            throw new common_1.BadRequestException('Contact not found');
        }
        const templatePayload = {
            name: templateName,
            language: { code: languageCode },
        };
        if (components && components.length > 0) {
            templatePayload.components = components;
        }
        const url = `https://graph.facebook.com/v20.0/${org.phoneNumberId}/messages`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${org.facebookAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: contact.waId,
                type: 'template',
                template: templatePayload,
            }),
        });
        const data = await response.json();
        if (data.error) {
            this.logger.error(`Failed to send template: ${data.error.message}`);
            const errorCode = data.error.code;
            let errorMessage = data.error.message;
            if (errorCode === 133010 || data.error.message.includes('not registered')) {
                errorMessage = 'This phone number is not registered on WhatsApp. Please verify the number has WhatsApp installed.';
            }
            else if (errorCode === 131030) {
                errorMessage = 'Invalid phone number format. Use country code without + (e.g., 919876543210)';
            }
            else if (errorCode === 132000) {
                errorMessage = 'Template parameters missing or invalid';
            }
            throw new common_1.BadRequestException(errorMessage);
        }
        const message = await this.prisma.message.create({
            data: {
                contactId,
                waMessageId: data.messages?.[0]?.id,
                content: `[Template: ${templateName}]`,
                type: client_1.MessageType.TEMPLATE,
                direction: client_1.MessageDirection.OUTBOUND,
                senderType: client_1.SenderType.AGENT,
                senderId,
                status: client_1.MessageStatus.SENT,
                timestamp: new Date(),
            },
        });
        await this.prisma.contact.update({
            where: { id: contactId },
            data: { lastMessageAt: new Date() },
        });
        this.logger.log(`Template message sent: ${message.id}`);
        this.gateway.emitNewMessage(organizationId, message);
        this.gateway.emitContactUpdate(organizationId, { id: contactId, lastMessageAt: new Date() });
        return message;
    }
};
exports.MessagingService = MessagingService;
exports.MessagingService = MessagingService = MessagingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        messaging_gateway_1.MessagingGateway])
], MessagingService);
//# sourceMappingURL=messaging.service.js.map