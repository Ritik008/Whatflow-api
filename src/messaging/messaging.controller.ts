import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChatStatus, SenderType } from '@prisma/client';

@Controller('messaging')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private messagingService: MessagingService) {}

  /**
   * Get all contacts/chats
   */
  @Get('contacts')
  async getContacts(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { contacts: [], total: 0 };
    }

    const chatStatus = status as ChatStatus | undefined;

    return this.messagingService.getContacts(
      organizationId,
      chatStatus,
      search,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );
  }

  /**
   * Get a single contact with messages
   */
  @Get('contacts/:id')
  async getContact(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
    @Query('messageLimit') messageLimit?: string,
  ) {
    const contact = await this.messagingService.getContactWithMessages(
      contactId,
      messageLimit ? parseInt(messageLimit) : 50,
    );

    // Mark messages as read
    if (contact) {
      await this.messagingService.markAsRead(contactId);
    }

    return contact;
  }

  /**
   * Get messages for a contact
   */
  @Get('contacts/:id/messages')
  async getMessages(
    @Param('id') contactId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const messages = await this.messagingService.getMessages(
      contactId,
      limit ? parseInt(limit) : 50,
      before,
    );
    return { messages, hasMore: messages.length === (limit ? parseInt(limit) : 50) };
  }

  /**
   * Send a message
   */
  @Post('send')
  async sendMessage(
    @CurrentUser() user: any,
    @Body() body: { contactId: string; text: string },
  ) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { success: false, error: 'No organization found' };
    }

    try {
      const message = await this.messagingService.sendTextMessage(
        organizationId,
        body.contactId,
        body.text,
        user.id,
        SenderType.AGENT,
      );

      return { success: true, message };
    } catch (error: any) {
      console.error('Send message error:', error);
      return { success: false, error: error.message || 'Failed to send message' };
    }
  }

  /**
   * Debug: Check WhatsApp connection status
   */
  @Get('debug/status')
  async getDebugStatus(@CurrentUser() user: any) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { error: 'No organization found' };
    }

    return this.messagingService.getConnectionDebugInfo(organizationId);
  }

  /**
   * Intervene in a chat
   */
  @Post('contacts/:id/intervene')
  async intervene(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
  ) {
    try {
      const contact = await this.messagingService.interveneChat(contactId, user.id);
      return { success: true, contact };
    } catch (error: any) {
      return { error: error.message || 'Failed to intervene' };
    }
  }

  /**
   * Resolve a chat
   */
  @Post('contacts/:id/resolve')
  async resolve(@Param('id') contactId: string) {
    try {
      const contact = await this.messagingService.resolveChat(contactId);
      return { success: true, contact };
    } catch (error: any) {
      return { error: error.message || 'Failed to resolve' };
    }
  }

  /**
   * Mark messages as read
   */
  @Post('contacts/:id/read')
  async markAsRead(@Param('id') contactId: string) {
    await this.messagingService.markAsRead(contactId);
    return { success: true };
  }

  /**
   * Create a new contact (for initiating conversations)
   */
  @Post('contacts')
  async createContact(
    @CurrentUser() user: any,
    @Body() body: { phone: string; name?: string },
  ) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { error: 'No organization found' };
    }

    try {
      const contact = await this.messagingService.createContact(
        organizationId,
        body.phone,
        body.name,
      );
      return { success: true, contact };
    } catch (error: any) {
      return { error: error.message || 'Failed to create contact' };
    }
  }

  /**
   * Send a template message to initiate conversation
   */
  @Post('send-template')
  async sendTemplate(
    @CurrentUser() user: any,
    @Body() body: { contactId: string; templateName: string; languageCode?: string; components?: any[] },
  ) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { error: 'No organization found' };
    }

    try {
      const message = await this.messagingService.sendTemplateMessage(
        organizationId,
        body.contactId,
        body.templateName,
        body.languageCode || 'en',
        body.components,
        user.id,
      );
      return { success: true, message };
    } catch (error: any) {
      return { error: error.message || 'Failed to send template' };
    }
  }

  /**
   * Get available message templates
   */
  @Get('templates')
  async getTemplates(@CurrentUser() user: any) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { templates: [] };
    }

    try {
      const templates = await this.messagingService.getMessageTemplates(organizationId);
      return { templates };
    } catch (error: any) {
      return { error: error.message, templates: [] };
    }
  }
}
