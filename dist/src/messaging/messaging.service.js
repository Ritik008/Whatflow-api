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
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
let MessagingService = MessagingService_1 = class MessagingService {
    prisma;
    gateway;
    configService;
    logger = new common_1.Logger(MessagingService_1.name);
    facebookVersion;
    constructor(prisma, gateway, configService) {
        this.prisma = prisma;
        this.gateway = gateway;
        this.configService = configService;
        this.facebookVersion = this.configService.get('FACEBOOK_GRAPH_API_VERSION', 'v20.0');
    }
    async processIncomingMessage(organizationId, message, contact) {
        this.logger.log(`Processing message from ${contact.wa_id}: ${message.type}`);
        this.gateway.emitWebhookLog(organizationId, {
            type: 'INFO',
            message: `📥 Incoming ${message.type} message from ${contact.profile?.name || contact.wa_id}`,
            data: {
                from: contact.wa_id,
                name: contact.profile?.name,
                type: message.type,
                waMessageId: message.id,
            },
            timestamp: new Date().toISOString(),
        });
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
        this.gateway.emitWebhookLog(organizationId, {
            type: 'SUCCESS',
            message: `📥 Message received and saved`,
            data: {
                messageId: dbMessage.id,
                content: content?.substring(0, 50) + (content && content.length > 50 ? '...' : ''),
                from: contact.wa_id,
            },
            timestamp: new Date().toISOString(),
        });
        return { contact: dbContact, message: dbMessage };
    }
    async processStatusUpdate(waMessageId, status) {
        const statusMap = {
            sent: client_1.MessageStatus.SENT,
            delivered: client_1.MessageStatus.DELIVERED,
            read: client_1.MessageStatus.READ,
            failed: client_1.MessageStatus.FAILED,
        };
        const statusEmojis = {
            sent: '✓',
            delivered: '✓✓',
            read: '👁️',
            failed: '❌',
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
            include: { contact: { select: { organizationId: true, name: true, phone: true } } },
        });
        if (message) {
            this.gateway.emitStatusUpdate(message.contact.organizationId, {
                waMessageId,
                status: dbStatus,
            });
            const logType = status === 'failed' ? 'ERROR' : 'INFO';
            this.gateway.emitWebhookLog(message.contact.organizationId, {
                type: logType,
                message: `${statusEmojis[status]} Message ${status.toUpperCase()}${message.contact.name ? ` - ${message.contact.name}` : ''}`,
                data: {
                    waMessageId,
                    status: dbStatus,
                    recipient: message.contact.phone,
                },
                timestamp: new Date().toISOString(),
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
                id: true,
                phoneNumberId: true,
                facebookAccessToken: true,
                whatsappConnected: true,
            },
        });
        if (!org) {
            this.logger.error(`Organization ${organizationId} not found`);
            throw new common_1.BadRequestException('Organization not found');
        }
        this.logger.log(`Organization status: connected=${org?.whatsappConnected}, phoneNumberId=${org?.phoneNumberId ? 'set' : 'missing'}, token=${org?.facebookAccessToken ? 'set' : 'missing'}`);
        if (!org?.whatsappConnected) {
            this.logger.warn(`Organization ${organizationId}: WhatsApp not connected`);
            throw new common_1.BadRequestException('WhatsApp is not connected. Please connect your WhatsApp Business account first.');
        }
        if (!org.phoneNumberId) {
            this.logger.warn(`Organization ${organizationId}: phoneNumberId missing`);
            throw new common_1.BadRequestException('WhatsApp phone number not configured. Please reconnect your WhatsApp Business account.');
        }
        if (!org.facebookAccessToken) {
            this.logger.warn(`Organization ${organizationId}: facebookAccessToken missing`);
            throw new common_1.BadRequestException('WhatsApp access token missing. Please reconnect your WhatsApp Business account.');
        }
        const contact = await this.prisma.contact.findUnique({
            where: { id: contactId },
        });
        if (!contact) {
            throw new common_1.BadRequestException('Contact not found');
        }
        const url = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}/messages`;
        this.logger.log(`Sending message to WhatsApp API: ${url}`);
        this.logger.log(`Recipient waId: ${contact.waId}`);
        const requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: contact.waId.replace(/\D/g, ''),
            type: 'text',
            text: { body: text },
        };
        this.logger.log(`Request Payload: ${JSON.stringify(requestBody)}`);
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
            this.gateway.emitWebhookLog(org.id, {
                type: 'ERROR',
                message: `❌ Send failed: ${errorMessage}`,
                data: { to: contact.phone, error: data.error },
                timestamp: new Date().toISOString(),
            });
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
        this.gateway.emitWebhookLog(org.id, {
            type: 'SUCCESS',
            message: `📤 Message sent to ${contact.name || contact.phone}`,
            data: {
                to: contact.phone,
                content: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                waMessageId: data.messages?.[0]?.id,
            },
            timestamp: new Date().toISOString(),
        });
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
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: 'WhatsApp not connected or missing WABA ID/Access Token for template retrieval.',
                timestamp: new Date().toISOString(),
            });
            throw new common_1.BadRequestException('WhatsApp not connected');
        }
        const url = `https://graph.facebook.com/${this.facebookVersion}/${org.wabaId}/message_templates?status=APPROVED`;
        this.gateway.emitWebhookLog(organizationId, {
            type: 'INFO',
            message: `Fetching message templates from Meta API: ${url}`,
            timestamp: new Date().toISOString(),
        });
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${org.facebookAccessToken}`,
            },
        });
        const data = await response.json();
        if (data.error) {
            this.logger.error(`Failed to fetch templates: ${data.error.message}`);
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: `Failed to fetch templates: ${data.error.message}`,
                data: data.error,
                timestamp: new Date().toISOString(),
            });
            throw new common_1.BadRequestException(data.error.message);
        }
        this.gateway.emitWebhookLog(organizationId, {
            type: 'SUCCESS',
            message: `Successfully fetched ${data.data?.length || 0} message templates.`,
            timestamp: new Date().toISOString(),
        });
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
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: 'Organization not found for debug info.',
                timestamp: new Date().toISOString(),
            });
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
                const testUrl = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}?access_token=${org.facebookAccessToken}`;
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'INFO',
                    message: `Testing Meta API access for phone number ID: ${org.phoneNumberId}`,
                    timestamp: new Date().toISOString(),
                });
                const response = await fetch(testUrl);
                const data = await response.json();
                if (data.error) {
                    this.gateway.emitWebhookLog(organizationId, {
                        type: 'ERROR',
                        message: `Meta API test failed for phone number ID: ${data.error.message}`,
                        data: data.error,
                        timestamp: new Date().toISOString(),
                    });
                    return {
                        ...status,
                        apiTest: {
                            success: false,
                            error: data.error.message,
                            errorCode: data.error.code,
                        },
                    };
                }
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'SUCCESS',
                    message: `Meta API test successful for phone number ID.`,
                    data: data,
                    timestamp: new Date().toISOString(),
                });
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
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'ERROR',
                    message: `Network error during Meta API test: ${error.message}`,
                    data: { error: error.message },
                    timestamp: new Date().toISOString(),
                });
                return {
                    ...status,
                    apiTest: {
                        success: false,
                        error: error.message,
                    },
                };
            }
        }
        this.gateway.emitWebhookLog(organizationId, {
            type: 'INFO',
            message: 'WhatsApp not fully connected, skipping Meta API test.',
            timestamp: new Date().toISOString(),
        });
        return status;
    }
    async testWhatsAppConnection(organizationId, testPhone) {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                phoneNumberId: true,
                facebookAccessToken: true,
                whatsappConnected: true,
                wabaId: true,
                phoneNumber: true,
            },
        });
        const result = {
            organizationId,
            whatsappConnected: org?.whatsappConnected || false,
            hasPhoneNumberId: !!org?.phoneNumberId,
            hasAccessToken: !!org?.facebookAccessToken,
            hasWabaId: !!org?.wabaId,
            configuredPhoneNumber: org?.phoneNumber,
        };
        if (!org?.whatsappConnected || !org.phoneNumberId || !org.facebookAccessToken) {
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: 'WhatsApp not properly configured for connection test.',
                timestamp: new Date().toISOString(),
            });
            return {
                ...result,
                success: false,
                error: 'WhatsApp not properly configured. Please reconnect your WhatsApp Business account.',
            };
        }
        try {
            const phoneCheckUrl = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}`;
            this.gateway.emitWebhookLog(organizationId, {
                type: 'INFO',
                message: `Connection Test 1: Checking phone number ID ${org.phoneNumberId} via Meta API.`,
                timestamp: new Date().toISOString(),
            });
            const phoneCheckResponse = await fetch(phoneCheckUrl, {
                headers: {
                    'Authorization': `Bearer ${org.facebookAccessToken}`,
                },
            });
            const phoneCheckData = await phoneCheckResponse.json();
            if (phoneCheckData.error) {
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'ERROR',
                    message: `Connection Test 1 Failed: Phone number API error: ${phoneCheckData.error.message}`,
                    data: phoneCheckData.error,
                    timestamp: new Date().toISOString(),
                });
                return {
                    ...result,
                    success: false,
                    error: `Phone number API error: ${phoneCheckData.error.message}`,
                    errorCode: phoneCheckData.error.code,
                    errorType: phoneCheckData.error.type,
                };
            }
            result.phoneNumberDetails = {
                id: phoneCheckData.id,
                displayPhoneNumber: phoneCheckData.display_phone_number,
                verifiedName: phoneCheckData.verified_name,
                qualityRating: phoneCheckData.quality_rating,
            };
            this.gateway.emitWebhookLog(organizationId, {
                type: 'SUCCESS',
                message: `Connection Test 1 Successful: Phone number ID accessible.`,
                data: result.phoneNumberDetails,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: `Connection Test 1 Failed: Network error checking phone: ${error.message}`,
                data: { error: error.message },
                timestamp: new Date().toISOString(),
            });
            return {
                ...result,
                success: false,
                error: `Network error checking phone: ${error.message}`,
            };
        }
        if (org.wabaId) {
            try {
                const wabaCheckUrl = `https://graph.facebook.com/${this.facebookVersion}/${org.wabaId}`;
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'INFO',
                    message: `Connection Test 2: Checking WABA ID ${org.wabaId} via Meta API.`,
                    timestamp: new Date().toISOString(),
                });
                const wabaCheckResponse = await fetch(wabaCheckUrl, {
                    headers: {
                        'Authorization': `Bearer ${org.facebookAccessToken}`,
                    },
                });
                const wabaCheckData = await wabaCheckResponse.json();
                if (wabaCheckData.error) {
                    result.wabaError = wabaCheckData.error.message;
                    this.gateway.emitWebhookLog(organizationId, {
                        type: 'ERROR',
                        message: `Connection Test 2 Failed: WABA API error: ${wabaCheckData.error.message}`,
                        data: wabaCheckData.error,
                        timestamp: new Date().toISOString(),
                    });
                }
                else {
                    result.wabaDetails = {
                        id: wabaCheckData.id,
                        name: wabaCheckData.name,
                    };
                    this.gateway.emitWebhookLog(organizationId, {
                        type: 'SUCCESS',
                        message: `Connection Test 2 Successful: WABA ID accessible.`,
                        data: result.wabaDetails,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            catch (error) {
                result.wabaError = error.message;
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'ERROR',
                    message: `Connection Test 2 Failed: Network error checking WABA: ${error.message}`,
                    data: { error: error.message },
                    timestamp: new Date().toISOString(),
                });
            }
        }
        if (testPhone) {
            const waId = testPhone.replace(/[\s\-\+]/g, '');
            this.gateway.emitWebhookLog(organizationId, {
                type: 'INFO',
                message: `Connection Test 3: Attempting to send a test template message to ${testPhone}.`,
                timestamp: new Date().toISOString(),
            });
            try {
                const templatesUrl = `https://graph.facebook.com/${this.facebookVersion}/${org.wabaId}/message_templates?status=APPROVED`;
                const templatesResponse = await fetch(templatesUrl, {
                    headers: {
                        'Authorization': `Bearer ${org.facebookAccessToken}`,
                    },
                });
                const templatesData = await templatesResponse.json();
                if (templatesData.data && templatesData.data.length > 0) {
                    const helloWorld = templatesData.data.find((t) => t.name === 'hello_world');
                    const firstTemplate = helloWorld || templatesData.data[0];
                    result.availableTemplates = templatesData.data.length;
                    result.testTemplate = firstTemplate.name;
                    const sendUrl = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}/messages`;
                    const sendResponse = await fetch(sendUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${org.facebookAccessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            messaging_product: 'whatsapp',
                            recipient_type: 'individual',
                            to: waId,
                            type: 'template',
                            template: {
                                name: firstTemplate.name,
                                language: { code: firstTemplate.language || 'en' },
                            },
                        }),
                    });
                    const sendData = await sendResponse.json();
                    if (sendData.error) {
                        result.sendTest = {
                            success: false,
                            error: sendData.error.message,
                            errorCode: sendData.error.code,
                        };
                        this.gateway.emitWebhookLog(organizationId, {
                            type: 'ERROR',
                            message: `Connection Test 3 Failed: Error sending test template: ${sendData.error.message}`,
                            data: sendData.error,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    else {
                        result.sendTest = {
                            success: true,
                            messageId: sendData.messages?.[0]?.id,
                        };
                        this.gateway.emitWebhookLog(organizationId, {
                            type: 'SUCCESS',
                            message: `Connection Test 3 Successful: Test template sent.`,
                            data: { messageId: sendData.messages?.[0]?.id },
                            timestamp: new Date().toISOString(),
                        });
                    }
                }
                else {
                    result.sendTest = {
                        success: false,
                        error: 'No approved templates found. You need at least one approved template to initiate conversations.',
                    };
                    this.gateway.emitWebhookLog(organizationId, {
                        type: 'WARN',
                        message: 'Connection Test 3 Warning: No approved templates found.',
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            catch (error) {
                result.sendTest = {
                    success: false,
                    error: `Error testing send: ${error.message}`,
                };
                this.gateway.emitWebhookLog(organizationId, {
                    type: 'ERROR',
                    message: `Connection Test 3 Failed: Network error during template send test: ${error.message}`,
                    data: { error: error.message },
                    timestamp: new Date().toISOString(),
                });
            }
        }
        result.success = true;
        this.gateway.emitWebhookLog(organizationId, {
            type: 'INFO',
            message: 'WhatsApp connection test completed.',
            data: result,
            timestamp: new Date().toISOString(),
        });
        return result;
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
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: 'WhatsApp not connected or missing credentials for template message.',
                timestamp: new Date().toISOString(),
            });
            throw new common_1.BadRequestException('WhatsApp not connected');
        }
        const contact = await this.prisma.contact.findUnique({
            where: { id: contactId },
        });
        if (!contact) {
            this.gateway.emitWebhookLog(organizationId, {
                type: 'ERROR',
                message: 'Contact not found for template message.',
                timestamp: new Date().toISOString(),
            });
            throw new common_1.BadRequestException('Contact not found');
        }
        const templatePayload = {
            name: templateName,
            language: { code: languageCode },
        };
        if (components && components.length > 0) {
            templatePayload.components = components;
        }
        const url = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}/messages`;
        const requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: contact.waId.replace(/\D/g, ''),
            type: 'template',
            template: templatePayload,
        };
        this.gateway.emitWebhookLog(organizationId, {
            type: 'INFO',
            message: `Sending template message '${templateName}' to Meta API.`,
            data: requestBody,
            timestamp: new Date().toISOString(),
        });
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${org.facebookAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
        const data = await response.json();
        this.gateway.emitWebhookLog(organizationId, {
            type: 'INFO',
            message: `Meta API Response for template message.`,
            data: data,
            timestamp: new Date().toISOString(),
        });
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
        messaging_gateway_1.MessagingGateway,
        config_1.ConfigService])
], MessagingService);
//# sourceMappingURL=messaging.service.js.map