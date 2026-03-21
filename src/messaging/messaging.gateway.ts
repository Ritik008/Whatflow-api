import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: '*', // In production, replace with your frontend URL
  },
  namespace: 'messaging',
})
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, organizationId: true },
      });

      if (!user || !user.organizationId) {
        throw new UnauthorizedException();
      }

      // Store user info in client data
      client.data.userId = user.id;
      client.data.organizationId = user.organizationId;

      // Join organization room
      client.join(`org_${user.organizationId}`);
      
      this.logger.log(`Client ${client.id} (User: ${user.id}) connected to Org: ${user.organizationId}`);
    } catch (error) {
      this.logger.error(`Connection authentication failed for client ${client.id}: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('join_chat')
  handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactId: string },
  ) {
    const orgId = client.data.organizationId;
    // Clients can join specific chat rooms if we want granular updates
    client.join(`chat_${data.contactId}`);
    this.logger.log(`User ${client.data.userId} joined chat room: ${data.contactId}`);
    return { status: 'ok' };
  }

  // Helper methods to emit events from the service
  emitNewMessage(organizationId: string, message: any) {
    this.server.to(`org_${organizationId}`).emit('new_message', message);
  }

  emitStatusUpdate(organizationId: string, data: { waMessageId: string; status: string }) {
    this.server.to(`org_${organizationId}`).emit('status_update', data);
  }

  emitContactUpdate(organizationId: string, contact: any) {
    this.server.to(`org_${organizationId}`).emit('contact_update', contact);
  }
}
