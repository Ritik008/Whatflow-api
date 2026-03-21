import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto';
export declare class AuthService {
    private prisma;
    private jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    register(dto: RegisterDto): Promise<{
        user: {
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            fullName: string;
            email: string;
            phone: string | null;
            id: string;
            role: import("@prisma/client").$Enums.Role;
        };
        token: string;
    }>;
    login(dto: LoginDto): Promise<{
        user: {
            organization: {
                id: string;
                name: string;
                slug: string;
                whatsappConnected: boolean;
            } | null;
            fullName: string;
            email: string;
            phone: string | null;
            id: string;
            avatar: string | null;
            role: import("@prisma/client").$Enums.Role;
            isActive: boolean;
            emailVerified: boolean;
            createdAt: Date;
            updatedAt: Date;
            organizationId: string | null;
        };
        token: string;
    }>;
    validateUser(userId: string): Promise<{
        organization: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            slug: string;
            logo: string | null;
            timezone: string;
            whatsappConnected: boolean;
            facebookAccessToken: string | null;
            facebookUserId: string | null;
            wabaId: string | null;
            phoneNumberId: string | null;
            phoneNumber: string | null;
            webhookVerifyToken: string | null;
        } | null;
        fullName: string;
        email: string;
        phone: string | null;
        id: string;
        avatar: string | null;
        role: import("@prisma/client").$Enums.Role;
        isActive: boolean;
        emailVerified: boolean;
        createdAt: Date;
        updatedAt: Date;
        organizationId: string | null;
    }>;
    private generateToken;
}
