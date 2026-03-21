import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
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
    me(user: any): Promise<{
        user: any;
    }>;
}
