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
exports.WhatsappController = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_service_1 = require("./whatsapp.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const config_1 = require("@nestjs/config");
let WhatsappController = class WhatsappController {
    whatsappService;
    configService;
    constructor(whatsappService, configService) {
        this.whatsappService = whatsappService;
        this.configService = configService;
    }
    async connect(user) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { error: 'No organization found' };
        }
        const oauthUrl = this.whatsappService.getOAuthUrl(organizationId);
        return { url: oauthUrl };
    }
    async callback(code, state, error, errorDescription, res) {
        const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:5173';
        if (error) {
            return res.redirect(`${frontendUrl}/dashboard?error=${encodeURIComponent(errorDescription || error)}`);
        }
        try {
            await this.whatsappService.handleCallback(code, state);
            return res.redirect(`${frontendUrl}/dashboard?connected=true`);
        }
        catch (err) {
            return res.redirect(`${frontendUrl}/dashboard?error=${encodeURIComponent(err.message)}`);
        }
    }
    async getStatus(user) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { connected: false };
        }
        const status = await this.whatsappService.getConnectionStatus(organizationId);
        return status;
    }
    async getAccountDetails(user) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { connected: false };
        }
        const details = await this.whatsappService.getAccountDetails(organizationId);
        return details;
    }
    async disconnect(user) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { error: 'No organization found' };
        }
        await this.whatsappService.disconnectWhatsApp(organizationId);
        return { success: true };
    }
    async embeddedSignup(user, body) {
        const organizationId = user.organizationId;
        if (!organizationId) {
            return { error: 'No organization found' };
        }
        if (!body.code && !body.accessToken) {
            return { error: 'Authorization code or access token is required' };
        }
        try {
            const result = await this.whatsappService.handleEmbeddedSignup(organizationId, body.code, body.accessToken);
            return result;
        }
        catch (err) {
            return { error: err.message || 'Failed to complete WhatsApp setup' };
        }
    }
};
exports.WhatsappController = WhatsappController;
__decorate([
    (0, common_1.Get)('connect'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "connect", null);
__decorate([
    (0, common_1.Get)('callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Query)('error')),
    __param(3, (0, common_1.Query)('error_description')),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "callback", null);
__decorate([
    (0, common_1.Get)('status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Get)('account-details'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "getAccountDetails", null);
__decorate([
    (0, common_1.Post)('disconnect'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Post)('embedded-signup'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "embeddedSignup", null);
exports.WhatsappController = WhatsappController = __decorate([
    (0, common_1.Controller)('whatsapp'),
    __metadata("design:paramtypes", [whatsapp_service_1.WhatsappService,
        config_1.ConfigService])
], WhatsappController);
//# sourceMappingURL=whatsapp.controller.js.map