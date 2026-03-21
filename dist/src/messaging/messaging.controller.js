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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagingController = void 0;
const common_1 = require("@nestjs/common");
const messaging_service_1 = require("./messaging.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const client_1 = require("@prisma/client");
let MessagingController = class MessagingController {
    messagingService;
    constructor(messagingService) {
        this.messagingService = messagingService;
    }
    async getContacts(user, status, search, limit, offset) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { contacts: [], total: 0 };
        }
        const chatStatus = status;
        return this.messagingService.getContacts(organizationId, chatStatus, search, limit ? parseInt(limit) : 50, offset ? parseInt(offset) : 0);
    }
    async getContact(user, contactId, messageLimit) {
        const contact = await this.messagingService.getContactWithMessages(contactId, messageLimit ? parseInt(messageLimit) : 50);
        if (contact) {
            await this.messagingService.markAsRead(contactId);
        }
        return contact;
    }
    async getMessages(contactId, limit, before) {
        const messages = await this.messagingService.getMessages(contactId, limit ? parseInt(limit) : 50, before);
        return { messages, hasMore: messages.length === (limit ? parseInt(limit) : 50) };
    }
    async sendMessage(user, body) {
        console.log('=== SEND MESSAGE REQUEST ===');
        console.log('User:', user?.id, 'Org:', user?.organizationId);
        console.log('Body:', { contactId: body.contactId, text: body.text?.substring(0, 50) });
        const organizationId = user.organizationId;
        if (!organizationId) {
            console.log('ERROR: No organization found');
            return { success: false, error: 'No organization found' };
        }
        try {
            const message = await this.messagingService.sendTextMessage(organizationId, body.contactId, body.text, user.id, client_1.SenderType.AGENT);
            console.log('SUCCESS: Message sent', message.id);
            return { success: true, message };
        }
        catch (error) {
            console.error('FAILED: Send message error:', error.message);
            return { success: false, error: error.message || 'Failed to send message' };
        }
    }
    async getDebugStatus(user) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { error: 'No organization found' };
        }
        return this.messagingService.getConnectionDebugInfo(organizationId);
    }
    async testSend(user, body) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { success: false, error: 'No organization found' };
        }
        return this.messagingService.testWhatsAppConnection(organizationId, body.phone);
    }
    async intervene(user, contactId) {
        try {
            const contact = await this.messagingService.interveneChat(contactId, user.id);
            return { success: true, contact };
        }
        catch (error) {
            return { error: error.message || 'Failed to intervene' };
        }
    }
    async resolve(contactId) {
        try {
            const contact = await this.messagingService.resolveChat(contactId);
            return { success: true, contact };
        }
        catch (error) {
            return { error: error.message || 'Failed to resolve' };
        }
    }
    async markAsRead(contactId) {
        await this.messagingService.markAsRead(contactId);
        return { success: true };
    }
    async createContact(user, body) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { error: 'No organization found' };
        }
        try {
            const contact = await this.messagingService.createContact(organizationId, body.phone, body.name);
            return { success: true, contact };
        }
        catch (error) {
            return { error: error.message || 'Failed to create contact' };
        }
    }
    async sendTemplate(user, body) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { error: 'No organization found' };
        }
        try {
            const message = await this.messagingService.sendTemplateMessage(organizationId, body.contactId, body.templateName, body.languageCode || 'en', body.components, user.id);
            return { success: true, message };
        }
        catch (error) {
            return { error: error.message || 'Failed to send template' };
        }
    }
    async getTemplates(user) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { templates: [] };
        }
        try {
            const templates = await this.messagingService.getMessageTemplates(organizationId);
            return { templates };
        }
        catch (error) {
            return { error: error.message, templates: [] };
        }
    }
};
exports.MessagingController = MessagingController;
__decorate([
    (0, common_1.Get)('contacts'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "getContacts", null);
__decorate([
    (0, common_1.Get)('contacts/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('messageLimit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "getContact", null);
__decorate([
    (0, common_1.Get)('contacts/:id/messages'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('before')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "getMessages", null);
__decorate([
    (0, common_1.Post)('send'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "sendMessage", null);
__decorate([
    (0, common_1.Get)('debug/status'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "getDebugStatus", null);
__decorate([
    (0, common_1.Post)('debug/test-send'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "testSend", null);
__decorate([
    (0, common_1.Post)('contacts/:id/intervene'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "intervene", null);
__decorate([
    (0, common_1.Post)('contacts/:id/resolve'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "resolve", null);
__decorate([
    (0, common_1.Post)('contacts/:id/read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "markAsRead", null);
__decorate([
    (0, common_1.Post)('contacts'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "createContact", null);
__decorate([
    (0, common_1.Post)('send-template'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "sendTemplate", null);
__decorate([
    (0, common_1.Get)('templates'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MessagingController.prototype, "getTemplates", null);
exports.MessagingController = MessagingController = __decorate([
    (0, common_1.Controller)('messaging'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [messaging_service_1.MessagingService])
], MessagingController);
//# sourceMappingURL=messaging.controller.js.map