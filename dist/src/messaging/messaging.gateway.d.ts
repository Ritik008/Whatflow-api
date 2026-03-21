import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
export declare class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private jwtService;
    private prisma;
    private readonly logger;
    server: Server;
    constructor(jwtService: JwtService, prisma: PrismaService);
    handleConnection(client: Socket): Promise<void>;
    handleDisconnect(client: Socket): void;
    handleJoinChat(client: Socket, data: {
        contactId: string;
    }): {
        status: string;
    };
    private getRoomClientCount;
    emitNewMessage(organizationId: string, message: any): void;
    emitStatusUpdate(organizationId: string, data: {
        waMessageId: string;
        status: string;
    }): void;
    emitContactUpdate(organizationId: string, contact: any): void;
    emitWebhookLog(organizationId: string, log: {
        type: string;
        message: string;
        data?: any;
        timestamp: string;
    }): void;
}
