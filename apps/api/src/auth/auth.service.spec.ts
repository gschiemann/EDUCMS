import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { cryptoPlatformConfig } from './crypto.config';
import * as argon2 from 'argon2';

describe('AuthService Security Properties', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock_jwt_token'),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            client: {
              user: {
                findUnique: jest.fn(),
                update: jest.fn(),
              },
              tenant: {
                findUnique: jest.fn().mockResolvedValue({ slug: 'test-school' }),
              },
            },
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Password Hashing (Argon2id)', () => {
    it('should generate hashes matching the required platform configuration', async () => {
      const password = 'extremely_secure_password_1!';
      const hash = await service.hashPassword(password);
      
      expect(hash).toContain('$argon2id');
      // Verifying parameters m=65536, t=3, p=4
      expect(hash).toContain(`m=${cryptoPlatformConfig.memoryCost}`);
      expect(hash).toContain(`t=${cryptoPlatformConfig.timeCost}`);
      expect(hash).toContain(`p=${cryptoPlatformConfig.parallelism}`);
    });

    it('should generate unique salts for the same password', async () => {
      const password = 'same_password_twice';
      const hash1 = await service.hashPassword(password);
      const hash2 = await service.hashPassword(password);
      expect(hash1).not.toEqual(hash2);
    });

    it('should successfully verify valid password', async () => {
      const password = 'test_password';
      const hash = await service.hashPassword(password);
      const isValid = await argon2.verify(hash, password, cryptoPlatformConfig);
      expect(isValid).toBeTruthy();
    });

    it('should explicitly reject invalid password', async () => {
      const password = 'test_password';
      const hash = await service.hashPassword(password);
      const isValid = await argon2.verify(hash, 'wrong_password', cryptoPlatformConfig);
      expect(isValid).toBeFalsy();
    });
  });

  describe('Login', () => {
    it('should return access_token and user info on login', async () => {
      const user = {
        id: 'user-1',
        email: 'test@school.edu',
        role: 'SCHOOL_ADMIN',
        tenantId: 'tenant-1',
        canTriggerPanic: false,
      };

      const result = await service.login(user);

      expect(result.access_token).toBe('mock_jwt_token');
      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('test@school.edu');
      expect(result.user.tenantSlug).toBe('test-school');
    });
  });
});
