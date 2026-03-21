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
var WhatsappService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
let WhatsappService = WhatsappService_1 = class WhatsappService {
    prisma;
    configService;
    logger = new common_1.Logger(WhatsappService_1.name);
    appId;
    appSecret;
    redirectUri;
    constructor(prisma, configService) {
        this.prisma = prisma;
        this.configService = configService;
        this.appId = this.configService.get('META_APP_ID') || '';
        this.appSecret = this.configService.get('META_APP_SECRET') || '';
        this.redirectUri = `${this.configService.get('API_BASE_URL')}/api/whatsapp/callback`;
    }
    getOAuthUrl(state) {
        const baseUrl = 'https://www.facebook.com/v20.0/dialog/oauth';
        const scope = [
            'whatsapp_business_management',
            'whatsapp_business_messaging',
            'business_management',
        ].join(',');
        const params = new URLSearchParams({
            client_id: this.appId,
            redirect_uri: this.redirectUri,
            scope,
            response_type: 'code',
            state,
        });
        return `${baseUrl}?${params.toString()}`;
    }
    async exchangeCodeForToken(code) {
        const url = 'https://graph.facebook.com/v20.0/oauth/access_token';
        const params = new URLSearchParams({
            client_id: this.appId,
            client_secret: this.appSecret,
            redirect_uri: this.redirectUri,
            code,
        });
        const response = await fetch(`${url}?${params.toString()}`);
        const data = await response.json();
        if (data.error) {
            throw new common_1.BadRequestException(data.error.message);
        }
        return data.access_token;
    }
    async getLongLivedToken(shortLivedToken) {
        const url = 'https://graph.facebook.com/v20.0/oauth/access_token';
        const params = new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: this.appId,
            client_secret: this.appSecret,
            fb_exchange_token: shortLivedToken,
        });
        const response = await fetch(`${url}?${params.toString()}`);
        const data = await response.json();
        if (data.error) {
            throw new common_1.BadRequestException(data.error.message);
        }
        return data.access_token;
    }
    async getWhatsAppBusinessAccounts(accessToken) {
        const businessesUrl = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;
        const businessesRes = await fetch(businessesUrl);
        const businessesData = await businessesRes.json();
        if (businessesData.error) {
            throw new common_1.BadRequestException(businessesData.error.message);
        }
        const wabaList = [];
        for (const business of businessesData.data || []) {
            const wabaUrl = `https://graph.facebook.com/v20.0/${business.id}/owned_whatsapp_business_accounts?access_token=${accessToken}`;
            const wabaRes = await fetch(wabaUrl);
            const wabaData = await wabaRes.json();
            if (wabaData.data) {
                for (const waba of wabaData.data) {
                    wabaList.push({
                        id: waba.id,
                        name: waba.name,
                        businessId: business.id,
                        businessName: business.name,
                    });
                }
            }
        }
        return wabaList;
    }
    async getPhoneNumbers(wabaId, accessToken) {
        const url = `https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?access_token=${accessToken}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.error) {
            throw new common_1.BadRequestException(data.error.message);
        }
        return data.data || [];
    }
    async connectWhatsApp(organizationId, accessToken, wabaId, phoneNumberId, phoneNumber) {
        const longLivedToken = await this.getLongLivedToken(accessToken);
        const organization = await this.prisma.organization.update({
            where: { id: organizationId },
            data: {
                whatsappConnected: true,
                facebookAccessToken: longLivedToken,
                wabaId,
                phoneNumberId,
                phoneNumber,
            },
        });
        return organization;
    }
    async handleCallback(code, organizationId) {
        const accessToken = await this.exchangeCodeForToken(code);
        const wabas = await this.getWhatsAppBusinessAccounts(accessToken);
        if (wabas.length === 0) {
            throw new common_1.BadRequestException('No WhatsApp Business Accounts found');
        }
        const waba = wabas[0];
        const phoneNumbers = await this.getPhoneNumbers(waba.id, accessToken);
        if (phoneNumbers.length === 0) {
            throw new common_1.BadRequestException('No phone numbers found in WhatsApp Business Account');
        }
        const phoneNumber = phoneNumbers[0];
        return this.connectWhatsApp(organizationId, accessToken, waba.id, phoneNumber.id, phoneNumber.display_phone_number);
    }
    async disconnectWhatsApp(organizationId) {
        return this.prisma.organization.update({
            where: { id: organizationId },
            data: {
                whatsappConnected: false,
                facebookAccessToken: null,
                wabaId: null,
                phoneNumberId: null,
                phoneNumber: null,
            },
        });
    }
    async getConnectionStatus(organizationId) {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                whatsappConnected: true,
                phoneNumber: true,
                wabaId: true,
                phoneNumberId: true,
            },
        });
        return org;
    }
    async getAccountDetails(organizationId) {
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                whatsappConnected: true,
                phoneNumber: true,
                wabaId: true,
                phoneNumberId: true,
                facebookAccessToken: true,
            },
        });
        if (!org?.whatsappConnected || !org.facebookAccessToken) {
            return { connected: false };
        }
        const accessToken = org.facebookAccessToken;
        const result = {
            connected: true,
            phoneNumber: org.phoneNumber,
            wabaId: org.wabaId,
            phoneNumberId: org.phoneNumberId,
        };
        if (org.phoneNumberId) {
            try {
                const phoneUrl = `https://graph.facebook.com/v20.0/${org.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status,name_status,status&access_token=${accessToken}`;
                const phoneRes = await fetch(phoneUrl);
                const phoneData = await phoneRes.json();
                if (!phoneData.error) {
                    result.phoneDetails = {
                        displayPhoneNumber: phoneData.display_phone_number,
                        verifiedName: phoneData.verified_name,
                        qualityRating: phoneData.quality_rating,
                        messagingLimitTier: phoneData.messaging_limit_tier,
                        codeVerificationStatus: phoneData.code_verification_status,
                        nameStatus: phoneData.name_status,
                        status: phoneData.status,
                    };
                }
                else {
                    this.logger.warn(`Failed to fetch phone details: ${phoneData.error.message}`);
                }
            }
            catch (err) {
                this.logger.warn(`Error fetching phone details: ${err.message}`);
            }
        }
        if (org.wabaId) {
            try {
                const wabaUrl = `https://graph.facebook.com/v20.0/${org.wabaId}?fields=name,account_review_status,business_verification_status,ownership_type&access_token=${accessToken}`;
                const wabaRes = await fetch(wabaUrl);
                const wabaData = await wabaRes.json();
                if (!wabaData.error) {
                    result.wabaDetails = {
                        name: wabaData.name,
                        accountReviewStatus: wabaData.account_review_status,
                        businessVerificationStatus: wabaData.business_verification_status,
                        ownershipType: wabaData.ownership_type,
                    };
                }
                else {
                    this.logger.warn(`Failed to fetch WABA details: ${wabaData.error.message}`);
                }
            }
            catch (err) {
                this.logger.warn(`Error fetching WABA details: ${err.message}`);
            }
            try {
                const templatesUrl = `https://graph.facebook.com/v20.0/${org.wabaId}/message_templates?fields=name,status&access_token=${accessToken}`;
                const templatesRes = await fetch(templatesUrl);
                const templatesData = await templatesRes.json();
                if (!templatesData.error && templatesData.data) {
                    const templates = templatesData.data;
                    result.templates = {
                        total: templates.length,
                        approved: templates.filter((t) => t.status === 'APPROVED').length,
                        pending: templates.filter((t) => t.status === 'PENDING').length,
                        rejected: templates.filter((t) => t.status === 'REJECTED').length,
                    };
                }
                else {
                    result.templates = { total: 0, approved: 0, pending: 0, rejected: 0 };
                }
            }
            catch (err) {
                this.logger.warn(`Error fetching templates: ${err.message}`);
                result.templates = { total: 0, approved: 0, pending: 0, rejected: 0 };
            }
        }
        return result;
    }
    async handleEmbeddedSignup(organizationId, code, providedAccessToken) {
        this.logger.log(`Processing embedded signup for org: ${organizationId}`);
        await this.prisma.organization.update({
            where: { id: organizationId },
            data: {
                whatsappConnected: false,
                facebookAccessToken: null,
                wabaId: null,
                phoneNumberId: null,
                phoneNumber: null,
            },
        });
        this.logger.log('Cleared existing WhatsApp connection data');
        let accessToken;
        if (providedAccessToken) {
            this.logger.log('Using provided access token');
            accessToken = providedAccessToken;
        }
        else if (code) {
            const tokenUrl = 'https://graph.facebook.com/v20.0/oauth/access_token';
            let params = new URLSearchParams({
                client_id: this.appId,
                client_secret: this.appSecret,
                code,
            });
            let tokenResponse = await fetch(`${tokenUrl}?${params.toString()}`);
            let tokenData = await tokenResponse.json();
            if (tokenData.error?.message?.includes('redirect_uri')) {
                this.logger.log('Retrying with empty redirect_uri...');
                params = new URLSearchParams({
                    client_id: this.appId,
                    client_secret: this.appSecret,
                    code,
                    redirect_uri: '',
                });
                tokenResponse = await fetch(`${tokenUrl}?${params.toString()}`);
                tokenData = await tokenResponse.json();
            }
            if (tokenData.error) {
                this.logger.error(`Token exchange failed: ${tokenData.error.message}`);
                throw new common_1.BadRequestException(tokenData.error.message);
            }
            accessToken = tokenData.access_token;
            this.logger.log('Successfully obtained access token from code exchange');
        }
        else {
            throw new common_1.BadRequestException('Either code or accessToken is required');
        }
        const debugUrl = `https://graph.facebook.com/v20.0/debug_token?input_token=${accessToken}&access_token=${this.appId}|${this.appSecret}`;
        const debugResponse = await fetch(debugUrl);
        const debugData = await debugResponse.json();
        this.logger.log('=== EMBEDDED SIGNUP DEBUG ===');
        this.logger.log(`Organization ID: ${organizationId}`);
        this.logger.log(`User ID from token: ${debugData.data?.user_id}`);
        this.logger.log(`Scopes: ${debugData.data?.scopes?.join(', ')}`);
        this.logger.log('Granular scopes:', JSON.stringify(debugData.data?.granular_scopes));
        let wabaId = null;
        let phoneNumberId = null;
        if (debugData.data?.granular_scopes) {
            for (const scope of debugData.data.granular_scopes) {
                if (scope.scope === 'whatsapp_business_messaging' && scope.target_ids?.length > 0) {
                    wabaId = scope.target_ids[0];
                    break;
                }
                if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
                    wabaId = scope.target_ids[0];
                    break;
                }
            }
        }
        if (wabaId) {
            this.logger.log(`=== FOUND WABA ===`);
            this.logger.log(`WABA ID: ${wabaId}`);
            const phoneNumbers = await this.getPhoneNumbers(wabaId, accessToken);
            if (phoneNumbers.length > 0) {
                phoneNumberId = phoneNumbers[0].id;
                const displayPhoneNumber = phoneNumbers[0].display_phone_number;
                const longLivedToken = await this.getLongLivedToken(accessToken);
                this.logger.log(`=== SAVING TO DATABASE ===`);
                this.logger.log(`Organization: ${organizationId}`);
                this.logger.log(`WABA ID: ${wabaId}`);
                this.logger.log(`Phone Number ID: ${phoneNumberId}`);
                this.logger.log(`Phone Number: ${displayPhoneNumber}`);
                await this.prisma.organization.update({
                    where: { id: organizationId },
                    data: {
                        whatsappConnected: true,
                        facebookAccessToken: longLivedToken,
                        wabaId,
                        phoneNumberId,
                        phoneNumber: displayPhoneNumber,
                    },
                });
                this.logger.log(`WhatsApp connected successfully for org: ${organizationId}`);
                return {
                    success: true,
                    phoneNumber: displayPhoneNumber,
                    wabaId,
                };
            }
        }
        this.logger.log('Trying to get WABAs through /me/businesses...');
        try {
            const wabas = await this.getWhatsAppBusinessAccounts(accessToken);
            this.logger.log(`Found ${wabas.length} WABAs through business management`);
            if (wabas.length > 0) {
                const waba = wabas[0];
                const phoneNumbers = await this.getPhoneNumbers(waba.id, accessToken);
                if (phoneNumbers.length > 0) {
                    const phoneNumber = phoneNumbers[0];
                    const longLivedToken = await this.getLongLivedToken(accessToken);
                    await this.prisma.organization.update({
                        where: { id: organizationId },
                        data: {
                            whatsappConnected: true,
                            facebookAccessToken: longLivedToken,
                            wabaId: waba.id,
                            phoneNumberId: phoneNumber.id,
                            phoneNumber: phoneNumber.display_phone_number,
                        },
                    });
                    return {
                        success: true,
                        phoneNumber: phoneNumber.display_phone_number,
                        wabaId: waba.id,
                    };
                }
                else {
                    this.logger.log('WABA found but no phone numbers registered');
                }
            }
        }
        catch (err) {
            this.logger.log(`Business management fallback failed: ${err.message}`);
        }
        const userId = debugData.data?.user_id;
        if (userId) {
            this.logger.log(`Trying to get shared WABAs for user: ${userId}`);
            const sharedWabaUrl = `https://graph.facebook.com/v20.0/${userId}/assigned_business_asset_groups?access_token=${accessToken}`;
            const sharedWabaRes = await fetch(sharedWabaUrl);
            const sharedWabaData = await sharedWabaRes.json();
            this.logger.log('Shared WABA data:', JSON.stringify(sharedWabaData));
        }
        throw new common_1.BadRequestException('WhatsApp Business Account not found. The Embedded Signup popup must show screens for: ' +
            '1) Selecting/creating a Business Portfolio, ' +
            '2) Creating a WhatsApp Business Account, ' +
            '3) Adding and verifying a phone number. ' +
            'If you only saw a permission consent screen, your Embedded Signup Configuration may not be set up correctly in Meta App Dashboard.');
    }
    async processEmbeddedSignupSession(organizationId, accessToken, sessionInfo) {
        const { phone_number_id, waba_id } = sessionInfo;
        this.logger.log(`Processing session info - WABA: ${waba_id}, Phone: ${phone_number_id}`);
        const phoneUrl = `https://graph.facebook.com/v20.0/${phone_number_id}?access_token=${accessToken}`;
        const phoneResponse = await fetch(phoneUrl);
        const phoneData = await phoneResponse.json();
        if (phoneData.error) {
            throw new common_1.BadRequestException(phoneData.error.message);
        }
        const displayPhoneNumber = phoneData.display_phone_number;
        const longLivedToken = await this.getLongLivedToken(accessToken);
        await this.prisma.organization.update({
            where: { id: organizationId },
            data: {
                whatsappConnected: true,
                facebookAccessToken: longLivedToken,
                wabaId: waba_id,
                phoneNumberId: phone_number_id,
                phoneNumber: displayPhoneNumber,
            },
        });
        return {
            success: true,
            phoneNumber: displayPhoneNumber,
            wabaId: waba_id,
        };
    }
};
exports.WhatsappService = WhatsappService;
exports.WhatsappService = WhatsappService = WhatsappService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], WhatsappService);
//# sourceMappingURL=whatsapp.service.js.map