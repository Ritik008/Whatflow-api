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
var MessagingGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagingGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../prisma/prisma.service");
let MessagingGateway = MessagingGateway_1 = class MessagingGateway {
    jwtService;
    prisma;
    logger = new common_1.Logger(MessagingGateway_1.name);
    server;
    constructor(jwtService, prisma) {
        this.jwtService = jwtService;
        this.prisma = prisma;
    }
    async handleConnection(client) {
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
                throw new common_1.UnauthorizedException();
            }
            client.data.userId = user.id;
            client.data.organizationId = user.organizationId;
            client.join(`org_${user.organizationId}`);
            this.logger.log(`Client ${client.id} (User: ${user.id}) connected to Org: ${user.organizationId}`);
        }
        catch (error) {
            this.logger.error(`Connection authentication failed for client ${client.id}: ${error.message}`);
            client.disconnect();
        }
    }
    handleDisconnect(client) {
        this.logger.log(`Client ${client.id} disconnected`);
    }
    handleJoinChat(client, data) {
        const orgId = client.data.organizationId;
        client.join(`chat_${data.contactId}`);
        this.logger.log(`User ${client.data.userId} joined chat room: ${data.contactId}`);
        return { status: 'ok' };
    }
    emitNewMessage(organizationId, message) {
        this.server.to(`org_${organizationId}`).emit('new_message', message);
    }
    emitStatusUpdate(organizationId, data) {
        this.server.to(`org_${organizationId}`).emit('status_update', data);
    }
    emitContactUpdate(organizationId, contact) {
        this.server.to(`org_${organizationId}`).emit('contact_update', contact);
    }
};
exports.MessagingGateway = MessagingGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], MessagingGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('join_chat'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], MessagingGateway.prototype, "handleJoinChat", null);
exports.MessagingGateway = MessagingGateway = MessagingGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: '*',
        },
        namespace: 'messaging',
    }),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        prisma_service_1.PrismaService])
], MessagingGateway);
//# sourceMappingURL=messaging.gateway.js.map