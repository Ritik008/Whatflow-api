import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingGateway } from './messaging.gateway';
import { ChatStatus, MessageDirection, MessageStatus, MessageType, SenderType } from '@prisma/client';

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  video?: { id: string; caption?: string };
  audio?: { id: string };
  document?: { id: string; filename?: string; caption?: string };
  sticker?: { id: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: any[];
  interactive?: any;
  button?: { text: string; payload: string };
}

interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: MessagingGateway,
  ) {}

  /**
   * Process incoming webhook message from WhatsApp
   */
  async processIncomingMessage(
    organizationId: string,
    message: WhatsAppMessage,
    contact: WhatsAppContact,
  ) {
    this.logger.log(`Processing message from ${contact.wa_id}: ${message.type}`);

    // Find or create contact
    const dbContact = await this.findOrCreateContact(
      organizationId,
      contact.wa_id,
      contact.profile?.name,
    );

    // Determine message content based on type
    let content: string | null = null;
    let mediaUrl: string | null = null;
    let mediaCaption: string | null = null;
    let messageType: MessageType = MessageType.TEXT;

    switch (message.type) {
      case 'text':
        content = message.text?.body || '';
        messageType = MessageType.TEXT;
        break;
      case 'image':
        messageType = MessageType.IMAGE;
        mediaCaption = message.image?.caption ?? null;
        // Media URL will be fetched separately if needed
        content = '[Image]';
        break;
      case 'video':
        messageType = MessageType.VIDEO;
        mediaCaption = message.video?.caption ?? null;
        content = '[Video]';
        break;
      case 'audio':
        messageType = MessageType.AUDIO;
        content = '[Audio]';
        break;
      case 'document':
        messageType = MessageType.DOCUMENT;
        mediaCaption = message.document?.caption ?? null;
        content = `[Document: ${message.document?.filename || 'file'}]`;
        break;
      case 'sticker':
        messageType = MessageType.STICKER;
        content = '[Sticker]';
        break;
      case 'location':
        messageType = MessageType.LOCATION;
        content = `[Location: ${message.location?.name || message.location?.address || 'Location'}]`;
        break;
      case 'contacts':
        messageType = MessageType.CONTACTS;
        content = '[Contact]';
        break;
      case 'interactive':
        messageType = MessageType.INTERACTIVE;
        content = message.interactive?.button_reply?.title ||
                  message.interactive?.list_reply?.title ||
                  '[Interactive]';
        break;
      case 'button':
        messageType = MessageType.TEXT;
        content = message.button?.text || '[Button]';
        break;
      default:
        content = `[${message.type}]`;
    }

    // Save message to database
    const dbMessage = await this.prisma.message.create({
      data: {
        contactId: dbContact.id,
        waMessageId: message.id,
        content,
        type: messageType,
        mediaUrl,
        mediaCaption,
        direction: MessageDirection.INBOUND,
        senderType: SenderType.USER,
        status: MessageStatus.DELIVERED,
        timestamp: new Date(parseInt(message.timestamp) * 1000),
      },
    });

    // Update contact's last message time
    await this.prisma.contact.update({
      where: { id: dbContact.id },
      data: { lastMessageAt: new Date() },
    });

    // Emit real-time update
    this.gateway.emitNewMessage(organizationId, dbMessage);
    this.gateway.emitContactUpdate(organizationId, dbContact);

    return { contact: dbContact, message: dbMessage };
  }

  /**
   * Process message status update from WhatsApp
   */
  async processStatusUpdate(
    waMessageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
  ) {
    const statusMap: Record<string, MessageStatus> = {
      sent: MessageStatus.SENT,
      delivered: MessageStatus.DELIVERED,
      read: MessageStatus.READ,
      failed: MessageStatus.FAILED,
    };

    const dbStatus = statusMap[status];
    if (!dbStatus) return;

    await this.prisma.message.updateMany({
      where: { waMessageId },
      data: {
        status: dbStatus,
        statusUpdatedAt: new Date(),
      },
    });

    // Get organizationId for the message to emit status update
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

  /**
   * Find or create a contact
   */
  async findOrCreateContact(
    organizationId: string,
    waId: string,
    name?: string,
  ) {
    let contact = await this.prisma.contact.findUnique({
      where: {
        organizationId_waId: {
          organizationId,
          waId,
        },
      },
    });

    if (!contact) {
      // Format phone number for display
      const phone = '+' + waId;

      contact = await this.prisma.contact.create({
        data: {
          organizationId,
          waId,
          phone,
          name: name || phone,
          status: ChatStatus.ACTIVE,
        },
      });

      this.logger.log(`Created new contact: ${contact.id}`);
    } else if (name && contact.name !== name) {
      // Update name if changed
      contact = await this.prisma.contact.update({
        where: { id: contact.id },
        data: { name },
      });
    }

    return contact;
  }

  /**
   * Send a text message via WhatsApp
   */
  async sendTextMessage(
    organizationId: string,
    contactId: string,
    text: string,
    senderId?: string,
    senderType: SenderType = SenderType.AGENT,
  ) {
    this.logger.log(`Attempting to send message to contact ${contactId}`);

    // Get organization and contact
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
      throw new BadRequestException('WhatsApp is not connected. Please connect your WhatsApp Business account first.');
    }

    if (!org.phoneNumberId) {
      throw new BadRequestException('WhatsApp phone number not configured. Please reconnect your WhatsApp Business account.');
    }

    if (!org.facebookAccessToken) {
      throw new BadRequestException('WhatsApp access token missing. Please reconnect your WhatsApp Business account.');
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new BadRequestException('Contact not found');
    }

    // Send via WhatsApp Cloud API
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

      // Provide user-friendly error messages
      const errorCode = data.error.code;
      let errorMessage = data.error.message;

      if (errorCode === 133010 || data.error.message.includes('not registered')) {
        errorMessage = 'This phone number is not registered on WhatsApp';
      } else if (errorCode === 131047) {
        errorMessage = 'Re-engagement message required. The 24-hour window has expired. Use a template message instead.';
      }

      throw new BadRequestException(errorMessage);
    }

    // Save message to database
    const message = await this.prisma.message.create({
      data: {
        contactId,
        waMessageId: data.messages?.[0]?.id,
        content: text,
        type: MessageType.TEXT,
        direction: MessageDirection.OUTBOUND,
        senderType,
        senderId,
        status: MessageStatus.SENT,
        timestamp: new Date(),
      },
    });

    // Update contact's last message time
    await this.prisma.contact.update({
      where: { id: contactId },
      data: { lastMessageAt: new Date() },
    });

    this.logger.log(`Message sent: ${message.id}`);

    // Emit real-time update
    this.gateway.emitNewMessage(organizationId, message);
    this.gateway.emitContactUpdate(organizationId, { id: contactId, lastMessageAt: new Date() });

    return message;
  }

  /**
   * Get contacts for an organization
   */
  async getContacts(
    organizationId: string,
    status?: ChatStatus,
    search?: string,
    limit = 50,
    offset = 0,
  ) {
    const where: any = { organizationId };

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
                  direction: MessageDirection.INBOUND,
                  status: { not: MessageStatus.READ },
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

  /**
   * Get messages for a contact
   */
  async getMessages(contactId: string, limit = 50, before?: string) {
    const where: any = { contactId };

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

    return messages.reverse(); // Return in chronological order
  }

  /**
   * Mark messages as read
   */
  async markAsRead(contactId: string) {
    await this.prisma.message.updateMany({
      where: {
        contactId,
        direction: MessageDirection.INBOUND,
        status: { not: MessageStatus.READ },
      },
      data: { status: MessageStatus.READ },
    });
  }

  /**
   * Intervene in a chat (take over from bot)
   */
  async interveneChat(contactId: string, agentId: string) {
    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        status: ChatStatus.INTERVENED,
        assignedToId: agentId,
      },
    });
  }

  /**
   * Resolve a chat
   */
  async resolveChat(contactId: string) {
    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        status: ChatStatus.RESOLVED,
        assignedToId: null,
      },
    });
  }

  /**
   * Get contact by ID with messages
   */
  async getContactWithMessages(contactId: string, messageLimit = 50) {
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

  /**
   * Create a new contact manually
   */
  async createContact(organizationId: string, phone: string, name?: string) {
    // Normalize phone number - remove spaces, dashes, and ensure no +
    const waId = phone.replace(/[\s\-\+]/g, '');
    const displayPhone = phone.startsWith('+') ? phone : `+${phone}`;

    // Check if contact already exists
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

    // Create new contact
    const contact = await this.prisma.contact.create({
      data: {
        organizationId,
        waId,
        phone: displayPhone,
        name: name || displayPhone,
        status: ChatStatus.ACTIVE,
      },
    });

    this.logger.log(`Created contact manually: ${contact.id}`);
    return contact;
  }

  /**
   * Get message templates from WhatsApp Business API
   */
  async getMessageTemplates(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        wabaId: true,
        facebookAccessToken: true,
        whatsappConnected: true,
      },
    });

    if (!org?.whatsappConnected || !org.wabaId || !org.facebookAccessToken) {
      throw new BadRequestException('WhatsApp not connected');
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
      throw new BadRequestException(data.error.message);
    }

    return data.data || [];
  }

  /**
   * Get connection debug info
   */
  async getConnectionDebugInfo(organizationId: string) {
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

    // If connected, test the API
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
      } catch (error: any) {
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

  /**
   * Send a template message to initiate conversation
   */
  async sendTemplateMessage(
    organizationId: string,
    contactId: string,
    templateName: string,
    languageCode: string,
    components?: any[],
    senderId?: string,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        phoneNumberId: true,
        facebookAccessToken: true,
        whatsappConnected: true,
      },
    });

    if (!org?.whatsappConnected || !org.phoneNumberId || !org.facebookAccessToken) {
      throw new BadRequestException('WhatsApp not connected');
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new BadRequestException('Contact not found');
    }

    // Build template message payload
    const templatePayload: any = {
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

      // Provide user-friendly error messages
      const errorCode = data.error.code;
      let errorMessage = data.error.message;

      if (errorCode === 133010 || data.error.message.includes('not registered')) {
        errorMessage = 'This phone number is not registered on WhatsApp. Please verify the number has WhatsApp installed.';
      } else if (errorCode === 131030) {
        errorMessage = 'Invalid phone number format. Use country code without + (e.g., 919876543210)';
      } else if (errorCode === 132000) {
        errorMessage = 'Template parameters missing or invalid';
      }

      throw new BadRequestException(errorMessage);
    }

    // Save message to database
    const message = await this.prisma.message.create({
      data: {
        contactId,
        waMessageId: data.messages?.[0]?.id,
        content: `[Template: ${templateName}]`,
        type: MessageType.TEMPLATE,
        direction: MessageDirection.OUTBOUND,
        senderType: SenderType.AGENT,
        senderId,
        status: MessageStatus.SENT,
        timestamp: new Date(),
      },
    });

    // Update contact's last message time
    await this.prisma.contact.update({
      where: { id: contactId },
      data: { lastMessageAt: new Date() },
    });

    this.logger.log(`Template message sent: ${message.id}`);

    // Emit real-time update
    this.gateway.emitNewMessage(organizationId, message);
    this.gateway.emitContactUpdate(organizationId, { id: contactId, lastMessageAt: new Date() });

    return message;
  }
}
