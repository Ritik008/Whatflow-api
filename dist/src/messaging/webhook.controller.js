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
var WebhookController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const messaging_service_1 = require("./messaging.service");
let WebhookController = WebhookController_1 = class WebhookController {
    configService;
    prisma;
    messagingService;
    logger = new common_1.Logger(WebhookController_1.name);
    verifyToken;
    constructor(configService, prisma, messagingService) {
        this.configService = configService;
        this.prisma = prisma;
        this.messagingService = messagingService;
        this.verifyToken = this.configService.get('WEBHOOK_VERIFY_TOKEN') || 'whatflow_webhook_token';
    }
    verifyWebhook(mode, token, challenge, res) {
        this.logger.log(`Webhook verification: mode=${mode}, token=${token}`);
        if (mode === 'subscribe' && token === this.verifyToken) {
            this.logger.log('Webhook verified successfully');
            return res.status(200).send(challenge);
        }
        this.logger.warn('Webhook verification failed');
        return res.status(403).send('Forbidden');
    }
    async handleWebhook(body, res) {
        res.status(200).send('EVENT_RECEIVED');
        try {
            await this.processWebhookPayload(body);
        }
        catch (error) {
            this.logger.error(`Error processing webhook: ${error.message}`, error.stack);
        }
    }
    async processWebhookPayload(payload) {
        if (payload.object !== 'whatsapp_business_account') {
            this.logger.log(`Ignoring non-WhatsApp webhook: ${payload.object}`);
            return;
        }
        for (const entry of payload.entry || []) {
            const wabaId = entry.id;
            const org = await this.prisma.organization.findFirst({
                where: { wabaId },
            });
            if (!org) {
                this.logger.warn(`No organization found for WABA ID: ${wabaId}`);
                continue;
            }
            for (const change of entry.changes || []) {
                if (change.field !== 'messages')
                    continue;
                const value = change.value;
                if (value.messages) {
                    for (const message of value.messages) {
                        const contact = value.contacts?.find((c) => c.wa_id === message.from);
                        await this.messagingService.processIncomingMessage(org.id, message, contact || { wa_id: message.from, profile: { name: message.from } });
                    }
                }
                if (value.statuses) {
                    for (const status of value.statuses) {
                        await this.messagingService.processStatusUpdate(status.id, status.status);
                    }
                }
            }
        }
    }
};
exports.WebhookController = WebhookController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('hub.mode')),
    __param(1, (0, common_1.Query)('hub.verify_token')),
    __param(2, (0, common_1.Query)('hub.challenge')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "verifyWebhook", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebhookController.prototype, "handleWebhook", null);
exports.WebhookController = WebhookController = WebhookController_1 = __decorate([
    (0, common_1.Controller)('webhook'),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        messaging_service_1.MessagingService])
], WebhookController);
//# sourceMappingURL=webhook.controller.js.map