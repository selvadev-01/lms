import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * Password hashing and verification.
 *
 * Uses argon2id with OWASP-aligned parameters, all configurable (Q-PWD-9).
 * Plaintext passwords are never stored, logged or returned (story rules 16-18).
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  /**
   * Hash of a random throwaway secret, used to spend verification time on
   * accounts that cannot possibly authenticate.
   */
  private dummyHash!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  private get options(): argon2.HashOptions {
    return {
      type: argon2.argon2id,
      memoryCost: this.config.get<number>('auth.argon2MemoryKib') ?? 19456,
      timeCost: this.config.get<number>('auth.argon2TimeCost') ?? 2,
      parallelism: this.config.get<number>('auth.argon2Parallelism') ?? 1,
    };
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { ...this.options, raw: false });
  }

  /**
   * Verifies a password against a stored hash.
   *
   * A null hash is a real code path — `User.passwordHash` is nullable, and an
   * unknown mobile number produces no user at all. Both cases still run a full
   * argon2 verification against a dummy hash so that "no such account" costs
   * the same wall-clock time as "wrong password". Without this, response timing
   * reveals which mobile numbers are registered, defeating the generic error
   * message required by rule 15 and Scenarios 3 and 22.
   */
  async verify(
    hash: string | null | undefined,
    plain: string,
  ): Promise<boolean> {
    if (!hash) {
      await argon2.verify(this.dummyHash, plain).catch(() => false);
      return false;
    }
    return argon2.verify(hash, plain).catch(() => false);
  }

  /** Spends one verification's worth of time without any account in hand. */
  async burn(plain: string): Promise<void> {
    await argon2.verify(this.dummyHash, plain).catch(() => false);
  }
}
