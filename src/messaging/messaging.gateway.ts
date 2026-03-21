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
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    credentials: true,
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
        client.emit('auth_error', { message: 'No token provided' });
        client.disconnect();
        return;
      }

      let payload;
      try {
        payload = await this.jwtService.verifyAsync(token);
      } catch (jwtError) {
        this.logger.error(`JWT verification failed for client ${client.id}: ${jwtError.message}`);
        client.emit('auth_error', { message: 'Invalid or expired token' });
        client.disconnect();
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, organizationId: true },
      });

      if (!user) {
        this.logger.error(`User not found for client ${client.id}, userId: ${payload.sub}`);
        client.emit('auth_error', { message: 'User not found' });
        client.disconnect();
        return;
      }

      if (!user.organizationId) {
        this.logger.error(`User ${user.id} has no organization`);
        client.emit('auth_error', { message: 'User has no organization' });
        client.disconnect();
        return;
      }

      // Store user info in client data
      client.data.userId = user.id;
      client.data.organizationId = user.organizationId;

      // Join organization room
      client.join(`org_${user.organizationId}`);

      this.logger.log(`Client ${client.id} (User: ${user.id}) connected to Org: ${user.organizationId}`);
    } catch (error) {
      this.logger.error(`Connection authentication failed for client ${client.id}: ${error.message}`);
      client.emit('auth_error', { message: error.message });
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

  // Helper to safely get room client count
  private getRoomClientCount(room: string): number {
    try {
      return this.server?.sockets?.adapter?.rooms?.get(room)?.size || 0;
    } catch {
      return 0;
    }
  }

  // Helper methods to emit events from the service
  emitNewMessage(organizationId: string, message: any) {
    if (!this.server) {
      this.logger.warn('[EMIT] Server not ready, skipping new_message emit');
      return;
    }
    const room = `org_${organizationId}`;
    const clientCount = this.getRoomClientCount(room);
    this.logger.log(`[EMIT] new_message to room ${room} (${clientCount} clients)`);
    this.server.to(room).emit('new_message', message);
  }

  emitStatusUpdate(organizationId: string, data: { waMessageId: string; status: string }) {
    if (!this.server) {
      this.logger.warn('[EMIT] Server not ready, skipping status_update emit');
      return;
    }
    const room = `org_${organizationId}`;
    const clientCount = this.getRoomClientCount(room);
    this.logger.log(`[EMIT] status_update to room ${room} (${clientCount} clients): ${data.status}`);
    this.server.to(room).emit('status_update', data);
  }

  emitContactUpdate(organizationId: string, contact: any) {
    if (!this.server) {
      this.logger.warn('[EMIT] Server not ready, skipping contact_update emit');
      return;
    }
    const room = `org_${organizationId}`;
    const clientCount = this.getRoomClientCount(room);
    this.logger.log(`[EMIT] contact_update to room ${room} (${clientCount} clients)`);
    this.server.to(room).emit('contact_update', contact);
  }

  emitWebhookLog(organizationId: string, log: { type: string; message: string; data?: any; timestamp: string; category?: string }) {
    if (!this.server) return;
    const room = `org_${organizationId}`;
    this.server.to(room).emit('webhook_log', log);
  }

  // Broadcast to ALL connected clients (used when org can't be identified)
  emitBroadcast(event: string, data: any) {
    if (!this.server) return;
    this.server.emit(event, data);
  }
}
