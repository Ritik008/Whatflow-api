import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface EmbeddedSignupData {
  phone_number_id: string;
  waba_id: string;
  display_phone_number?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.appId = this.configService.get<string>('META_APP_ID') || '';
    this.appSecret = this.configService.get<string>('META_APP_SECRET') || '';
    this.redirectUri = `${this.configService.get<string>('API_BASE_URL')}/api/whatsapp/callback`;
  }

  /**
   * Generate Facebook OAuth URL for WhatsApp Business signup
   * This is the Embedded Signup flow
   */
  getOAuthUrl(state: string): string {
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
      state, // Pass organizationId as state
    });

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
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
      throw new BadRequestException(data.error.message);
    }

    return data.access_token;
  }

  /**
   * Get long-lived access token (valid for 60 days)
   */
  async getLongLivedToken(shortLivedToken: string): Promise<string> {
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
      throw new BadRequestException(data.error.message);
    }

    return data.access_token;
  }

  /**
   * Get WhatsApp Business Accounts associated with the user
   */
  async getWhatsAppBusinessAccounts(accessToken: string): Promise<any[]> {
    // First, get the user's businesses
    const businessesUrl = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;
    const businessesRes = await fetch(businessesUrl);
    const businessesData = await businessesRes.json();

    if (businessesData.error) {
      throw new BadRequestException(businessesData.error.message);
    }

    const wabaList: any[] = [];

    // For each business, get the WhatsApp Business Accounts
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

  /**
   * Get phone numbers for a WhatsApp Business Account
   */
  async getPhoneNumbers(wabaId: string, accessToken: string): Promise<any[]> {
    const url = `https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new BadRequestException(data.error.message);
    }

    return data.data || [];
  }

  /**
   * Complete the WhatsApp connection for an organization
   */
  async connectWhatsApp(
    organizationId: string,
    accessToken: string,
    wabaId: string,
    phoneNumberId: string,
    phoneNumber: string,
  ) {
    // Get long-lived token
    const longLivedToken = await this.getLongLivedToken(accessToken);

    // Update organization with WhatsApp details
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

  /**
   * Handle the OAuth callback
   */
  async handleCallback(code: string, organizationId: string) {
    // Exchange code for token
    const accessToken = await this.exchangeCodeForToken(code);

    // Get WABAs
    const wabas = await this.getWhatsAppBusinessAccounts(accessToken);

    if (wabas.length === 0) {
      throw new BadRequestException('No WhatsApp Business Accounts found');
    }

    // For now, use the first WABA
    const waba = wabas[0];

    // Get phone numbers
    const phoneNumbers = await this.getPhoneNumbers(waba.id, accessToken);

    if (phoneNumbers.length === 0) {
      throw new BadRequestException('No phone numbers found in WhatsApp Business Account');
    }

    // Use the first phone number
    const phoneNumber = phoneNumbers[0];

    // Connect WhatsApp
    return this.connectWhatsApp(
      organizationId,
      accessToken,
      waba.id,
      phoneNumber.id,
      phoneNumber.display_phone_number,
    );
  }

  /**
   * Disconnect WhatsApp from organization
   */
  async disconnectWhatsApp(organizationId: string) {
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

  /**
   * Get connection status
   */
  async getConnectionStatus(organizationId: string) {
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

  /**
   * Get detailed account information from Meta Graph API
   */
  async getAccountDetails(organizationId: string) {
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
    const result: any = {
      connected: true,
      phoneNumber: org.phoneNumber,
      wabaId: org.wabaId,
      phoneNumberId: org.phoneNumberId,
    };

    // Fetch phone number details (quality rating, verified name, messaging limits)
    if (org.phoneNumberId) {
      try {
        const phoneUrl = `https://graph.facebook.com/v20.0/${org.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status,name_status,status&access_token=${accessToken}`;
        const phoneRes = await fetch(phoneUrl);
        const phoneData = await phoneRes.json();

        if (!phoneData.error) {
          result.phoneDetails = {
            displayPhoneNumber: phoneData.display_phone_number,
            verifiedName: phoneData.verified_name,
            qualityRating: phoneData.quality_rating, // GREEN, YELLOW, RED
            messagingLimitTier: phoneData.messaging_limit_tier, // TIER_1K, TIER_10K, TIER_100K, UNLIMITED
            codeVerificationStatus: phoneData.code_verification_status,
            nameStatus: phoneData.name_status, // APPROVED, PENDING, DECLINED
            status: phoneData.status, // CONNECTED, DISCONNECTED, etc.
          };
        } else {
          this.logger.warn(`Failed to fetch phone details: ${phoneData.error.message}`);
        }
      } catch (err) {
        this.logger.warn(`Error fetching phone details: ${err.message}`);
      }
    }

    // Fetch WABA details
    if (org.wabaId) {
      try {
        const wabaUrl = `https://graph.facebook.com/v20.0/${org.wabaId}?fields=name,account_review_status,business_verification_status,ownership_type&access_token=${accessToken}`;
        const wabaRes = await fetch(wabaUrl);
        const wabaData = await wabaRes.json();

        if (!wabaData.error) {
          result.wabaDetails = {
            name: wabaData.name,
            accountReviewStatus: wabaData.account_review_status, // APPROVED, PENDING
            businessVerificationStatus: wabaData.business_verification_status,
            ownershipType: wabaData.ownership_type,
          };
        } else {
          this.logger.warn(`Failed to fetch WABA details: ${wabaData.error.message}`);
        }
      } catch (err) {
        this.logger.warn(`Error fetching WABA details: ${err.message}`);
      }

      // Fetch message templates count
      try {
        const templatesUrl = `https://graph.facebook.com/v20.0/${org.wabaId}/message_templates?fields=name,status&access_token=${accessToken}`;
        const templatesRes = await fetch(templatesUrl);
        const templatesData = await templatesRes.json();

        if (!templatesData.error && templatesData.data) {
          const templates = templatesData.data;
          result.templates = {
            total: templates.length,
            approved: templates.filter((t: any) => t.status === 'APPROVED').length,
            pending: templates.filter((t: any) => t.status === 'PENDING').length,
            rejected: templates.filter((t: any) => t.status === 'REJECTED').length,
          };
        } else {
          result.templates = { total: 0, approved: 0, pending: 0, rejected: 0 };
        }
      } catch (err) {
        this.logger.warn(`Error fetching templates: ${err.message}`);
        result.templates = { total: 0, approved: 0, pending: 0, rejected: 0 };
      }
    }

    return result;
  }

  /**
   * Handle WhatsApp Embedded Signup
   * This processes the code or accessToken from FB.login() embedded signup flow
   */
  async handleEmbeddedSignup(
    organizationId: string,
    code?: string,
    providedAccessToken?: string,
  ) {
    this.logger.log(`Processing embedded signup for org: ${organizationId}`);

    // First, disconnect any existing WhatsApp connection to ensure fresh data
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

    let accessToken: string;

    // If we already have an access token, use it directly
    if (providedAccessToken) {
      this.logger.log('Using provided access token');
      accessToken = providedAccessToken;
    } else if (code) {
      // Exchange the code for an access token
      const tokenUrl = 'https://graph.facebook.com/v20.0/oauth/access_token';

      // Try without redirect_uri first (correct for FB.login popup flow)
      let params = new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        code,
      });

      let tokenResponse = await fetch(`${tokenUrl}?${params.toString()}`);
      let tokenData = await tokenResponse.json();

      // If that fails with redirect_uri error, try with different redirect_uri values
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
        throw new BadRequestException(tokenData.error.message);
      }

      accessToken = tokenData.access_token;
      this.logger.log('Successfully obtained access token from code exchange');
    } else {
      throw new BadRequestException('Either code or accessToken is required');
    }

    // Get the debug token info to find shared WABAs
    const debugUrl = `https://graph.facebook.com/v20.0/debug_token?input_token=${accessToken}&access_token=${this.appId}|${this.appSecret}`;
    const debugResponse = await fetch(debugUrl);
    const debugData = await debugResponse.json();

    this.logger.log('=== EMBEDDED SIGNUP DEBUG ===');
    this.logger.log(`Organization ID: ${organizationId}`);
    this.logger.log(`User ID from token: ${debugData.data?.user_id}`);
    this.logger.log(`Scopes: ${debugData.data?.scopes?.join(', ')}`);
    this.logger.log('Granular scopes:', JSON.stringify(debugData.data?.granular_scopes));

    // Get shared WABA info from the token's granular scopes
    let wabaId: string | null = null;
    let phoneNumberId: string | null = null;

    if (debugData.data?.granular_scopes) {
      for (const scope of debugData.data.granular_scopes) {
        if (scope.scope === 'whatsapp_business_messaging' && scope.target_ids?.length > 0) {
          // These are the WABA IDs the user granted access to
          wabaId = scope.target_ids[0];
          break;
        }
        if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
          wabaId = scope.target_ids[0];
          break;
        }
      }
    }

    // If we found a WABA from granular_scopes, get its phone numbers
    if (wabaId) {
      this.logger.log(`=== FOUND WABA ===`);
      this.logger.log(`WABA ID: ${wabaId}`);
      const phoneNumbers = await this.getPhoneNumbers(wabaId, accessToken);

      if (phoneNumbers.length > 0) {
        phoneNumberId = phoneNumbers[0].id;
        const displayPhoneNumber = phoneNumbers[0].display_phone_number;

        // Get long-lived token
        const longLivedToken = await this.getLongLivedToken(accessToken);

        // Save to database
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

    // Fallback 1: Try to get WABAs through business management (since we have business_management permission)
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
        } else {
          this.logger.log('WABA found but no phone numbers registered');
        }
      }
    } catch (err) {
      this.logger.log(`Business management fallback failed: ${err.message}`);
    }

    // Fallback 2: Try to get shared WABAs directly using the user ID
    const userId = debugData.data?.user_id;
    if (userId) {
      this.logger.log(`Trying to get shared WABAs for user: ${userId}`);

      // Try getting WABAs shared with this user/system user
      const sharedWabaUrl = `https://graph.facebook.com/v20.0/${userId}/assigned_business_asset_groups?access_token=${accessToken}`;
      const sharedWabaRes = await fetch(sharedWabaUrl);
      const sharedWabaData = await sharedWabaRes.json();

      this.logger.log('Shared WABA data:', JSON.stringify(sharedWabaData));
    }

    // If we still don't have a WABA, the user didn't complete the signup flow
    throw new BadRequestException(
      'WhatsApp Business Account not found. The Embedded Signup popup must show screens for: ' +
      '1) Selecting/creating a Business Portfolio, ' +
      '2) Creating a WhatsApp Business Account, ' +
      '3) Adding and verifying a phone number. ' +
      'If you only saw a permission consent screen, your Embedded Signup Configuration may not be set up correctly in Meta App Dashboard.',
    );
  }

  /**
   * Process webhook session info from Embedded Signup
   * This is called when we receive session info via postMessage
   */
  async processEmbeddedSignupSession(
    organizationId: string,
    accessToken: string,
    sessionInfo: EmbeddedSignupData,
  ) {
    const { phone_number_id, waba_id } = sessionInfo;

    this.logger.log(`Processing session info - WABA: ${waba_id}, Phone: ${phone_number_id}`);

    // Get phone number details
    const phoneUrl = `https://graph.facebook.com/v20.0/${phone_number_id}?access_token=${accessToken}`;
    const phoneResponse = await fetch(phoneUrl);
    const phoneData = await phoneResponse.json();

    if (phoneData.error) {
      throw new BadRequestException(phoneData.error.message);
    }

    const displayPhoneNumber = phoneData.display_phone_number;

    // Get long-lived token
    const longLivedToken = await this.getLongLivedToken(accessToken);

    // Update organization
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
}
