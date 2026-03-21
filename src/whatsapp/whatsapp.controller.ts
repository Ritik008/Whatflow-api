import { Controller, Get, Post, Query, Res, UseGuards, Body } from '@nestjs/common';
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private whatsappService: WhatsappService,
    private configService: ConfigService,
  ) {}

  /**
   * Start Facebook OAuth flow
   * Frontend calls this to get the OAuth URL
   */
  @Get('connect')
  @UseGuards(JwtAuthGuard)
  async connect(@CurrentUser() user: any) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { error: 'No organization found' };
    }

    const oauthUrl = this.whatsappService.getOAuthUrl(organizationId);

    return { url: oauthUrl };
  }

  /**
   * OAuth callback from Facebook
   * Facebook redirects here after user authorizes
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string, // organizationId
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    if (error) {
      // Redirect to frontend with error
      return res.redirect(`${frontendUrl}/dashboard?error=${encodeURIComponent(errorDescription || error)}`);
    }

    try {
      // Handle the callback and connect WhatsApp
      await this.whatsappService.handleCallback(code, state);

      // Redirect to frontend with success
      return res.redirect(`${frontendUrl}/dashboard?connected=true`);
    } catch (err: any) {
      // Redirect to frontend with error
      return res.redirect(`${frontendUrl}/dashboard?error=${encodeURIComponent(err.message)}`);
    }
  }

  /**
   * Get connection status
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@CurrentUser() user: any) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { connected: false };
    }

    const status = await this.whatsappService.getConnectionStatus(organizationId);

    return status;
  }

  /**
   * Get detailed account information from Meta API
   */
  @Get('account-details')
  @UseGuards(JwtAuthGuard)
  async getAccountDetails(@CurrentUser() user: any) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { connected: false };
    }

    const details = await this.whatsappService.getAccountDetails(organizationId);

    return details;
  }

  /**
   * Disconnect WhatsApp
   */
  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@CurrentUser() user: any) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { error: 'No organization found' };
    }

    await this.whatsappService.disconnectWhatsApp(organizationId);

    return { success: true };
  }

  /**
   * Handle WhatsApp Embedded Signup
   * Frontend calls this with the code and/or accessToken from FB.login()
   */
  @Post('embedded-signup')
  @UseGuards(JwtAuthGuard)
  async embeddedSignup(
    @CurrentUser() user: any,
    @Body() body: { code?: string; accessToken?: string },
  ) {
    const organizationId = user.organizationId;

    if (!organizationId) {
      return { error: 'No organization found' };
    }

    if (!body.code && !body.accessToken) {
      return { error: 'Authorization code or access token is required' };
    }

    try {
      const result = await this.whatsappService.handleEmbeddedSignup(
        organizationId,
        body.code,
        body.accessToken,
      );
      return result;
    } catch (err: any) {
      return { error: err.message || 'Failed to complete WhatsApp setup' };
    }
  }
}
