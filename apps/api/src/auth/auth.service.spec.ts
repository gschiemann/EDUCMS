import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
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
      const isValid = await service.verifyPassword(password, hash);
      expect(isValid).toBeTruthy();
    });

    it('should explicitly reject invalid password', async () => {
      const password = 'test_password';
      const hash = await service.hashPassword(password);
      const isValid = await service.verifyPassword('wrong_password', hash);
      expect(isValid).toBeFalsy();
    });
  });

  describe('Session Mechanics', () => {
    it('should rotate session ID upon login call', async () => {
      const regenerateMock = jest.fn((callback) => callback(null));
      const reqMock: any = {
        session: { regenerate: regenerateMock },
        ip: '127.0.0.1',
      };

      await service.login('user-id', reqMock);
      expect(regenerateMock).toHaveBeenCalled();
      expect(reqMock.session['userId']).toEqual('user-id');
    });
  });
});
