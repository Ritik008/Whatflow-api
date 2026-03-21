import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingGateway } from './messaging.gateway';
import { ConfigService } from '@nestjs/config'; // Added ConfigService
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
  private readonly facebookVersion: string; // Added facebookVersion property

  constructor(
    private prisma: PrismaService,
    private gateway: MessagingGateway,
    private configService: ConfigService, // Injected ConfigService
  ) {
    this.facebookVersion = this.configService.get<string>('FACEBOOK_GRAPH_API_VERSION', 'v20.0'); // Initialized facebookVersion
  }

  /**
   * Process incoming webhook message from WhatsApp
   */
  async processIncomingMessage(
    organizationId: string,
    message: WhatsAppMessage,
    contact: WhatsAppContact,
  ) {
    this.logger.log(`Processing message from ${contact.wa_id}: ${message.type}`);

    // Log incoming message event
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

    // Log success
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

    const statusEmojis: Record<string, string> = {
      sent: '✓',
      delivered: '✓✓',
      read: '👁️',
      failed: '❌',
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
      include: { contact: { select: { organizationId: true, name: true, phone: true } } },
    });

    if (message) {
      this.gateway.emitStatusUpdate(message.contact.organizationId, {
        waMessageId,
        status: dbStatus,
      });

      // Emit webhook log for status update
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
        id: true,
        phoneNumberId: true,
        facebookAccessToken: true,
        whatsappConnected: true,
      },
    });

    if (!org) {
      this.logger.error(`Organization ${organizationId} not found`);
      throw new BadRequestException('Organization not found');
    }

    this.logger.log(`Organization status: connected=${org?.whatsappConnected}, phoneNumberId=${org?.phoneNumberId ? 'set' : 'missing'}, token=${org?.facebookAccessToken ? 'set' : 'missing'}`);

    if (!org?.whatsappConnected) {
      this.logger.warn(`Organization ${organizationId}: WhatsApp not connected`);
      throw new BadRequestException('WhatsApp is not connected. Please connect your WhatsApp Business account first.');
    }

    if (!org.phoneNumberId) {
      this.logger.warn(`Organization ${organizationId}: phoneNumberId missing`);
      throw new BadRequestException('WhatsApp phone number not configured. Please reconnect your WhatsApp Business account.');
    }

    if (!org.facebookAccessToken) {
      this.logger.warn(`Organization ${organizationId}: facebookAccessToken missing`);
      throw new BadRequestException('WhatsApp access token missing. Please reconnect your WhatsApp Business account.');
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new BadRequestException('Contact not found');
    }

    // Send via WhatsApp Cloud API
    const url = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}/messages`;

    this.logger.log(`Sending message to WhatsApp API: ${url}`);
    this.logger.log(`Recipient waId: ${contact.waId}`);

    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: contact.waId.replace(/\D/g, ''), // Ensure ONLY digits for Meta
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

      // Provide user-friendly error messages
      const errorCode = data.error.code;
      let errorMessage = data.error.message;

      if (errorCode === 133010 || data.error.message.includes('not registered')) {
        errorMessage = 'This phone number is not registered on WhatsApp';
      } else if (errorCode === 131047) {
        errorMessage = 'Re-engagement message required. The 24-hour window has expired. Use a template message instead.';
      }

      this.gateway.emitWebhookLog(org.id, {
        type: 'ERROR',
        message: `❌ Send failed: ${errorMessage}`,
        data: { to: contact.phone, error: data.error },
        timestamp: new Date().toISOString(),
      });
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
      this.gateway.emitWebhookLog(organizationId, {
        type: 'ERROR',
        message: 'WhatsApp not connected or missing WABA ID/Access Token for template retrieval.',
        timestamp: new Date().toISOString(),
      });
      throw new BadRequestException('WhatsApp not connected');
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
      throw new BadRequestException(data.error.message);
    }

    this.gateway.emitWebhookLog(organizationId, {
      type: 'SUCCESS',
      message: `Successfully fetched ${data.data?.length || 0} message templates.`,
      timestamp: new Date().toISOString(),
    });

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

    // If connected, test the API
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
      } catch (error: any) {
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

  /**
   * Test WhatsApp connection by checking API access
   */
  async testWhatsAppConnection(organizationId: string, testPhone?: string) {
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

    const result: any = {
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

    // Test 1: Check if the phone number ID is accessible
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
    } catch (error: any) {
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

    // Test 2: Check WABA access
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
        } else {
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
      } catch (error: any) {
        result.wabaError = error.message;
        this.gateway.emitWebhookLog(organizationId, {
          type: 'ERROR',
          message: `Connection Test 2 Failed: Network error checking WABA: ${error.message}`,
          data: { error: error.message },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Test 3: If a test phone is provided, try to send a test template message
    if (testPhone) {
      const waId = testPhone.replace(/[\s\-\+]/g, '');
      this.gateway.emitWebhookLog(organizationId, {
        type: 'INFO',
        message: `Connection Test 3: Attempting to send a test template message to ${testPhone}.`,
        timestamp: new Date().toISOString(),
      });

      // Check if hello_world template exists (default Meta template)
      try {
        const templatesUrl = `https://graph.facebook.com/${this.facebookVersion}/${org.wabaId}/message_templates?status=APPROVED`;
        const templatesResponse = await fetch(templatesUrl, {
          headers: {
            'Authorization': `Bearer ${org.facebookAccessToken}`,
          },
        });
        const templatesData = await templatesResponse.json();

        if (templatesData.data && templatesData.data.length > 0) {
          const helloWorld = templatesData.data.find((t: any) => t.name === 'hello_world');
          const firstTemplate = helloWorld || templatesData.data[0];

          result.availableTemplates = templatesData.data.length;
          result.testTemplate = firstTemplate.name;

          // Try sending the template
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
          } else {
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
        } else {
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
      } catch (error: any) {
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
      this.gateway.emitWebhookLog(organizationId, {
        type: 'ERROR',
        message: 'WhatsApp not connected or missing credentials for template message.',
        timestamp: new Date().toISOString(),
      });
      throw new BadRequestException('WhatsApp not connected');
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

    const url = `https://graph.facebook.com/${this.facebookVersion}/${org.phoneNumberId}/messages`;

    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: contact.waId.replace(/\D/g, ''), // Ensure ONLY digits
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
