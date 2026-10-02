export type CreditStatus = 'available' | 'expired' | 'exhausted' | 'disabled';

export interface ProviderCreditAccount {
  providerId: string;
  balanceUsd: number;
  reservedUsd: number;
  expiresAt?: string;
  enabled: boolean;
  eligibleCapabilities?: string[];
  serviceLimits?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface CreditReservation {
  id: string;
  providerId: string;
  amountUsd: number;
  createdAt: string;
  status: 'reserved' | 'consumed' | 'released';
}

export interface CreditCheck {
  providerId: string;
  status: CreditStatus;
  availableUsd: number;
  expiresAt?: string;
  reason: string;
}

export interface CreditLedger {
  get(providerId: string): ProviderCreditAccount | undefined;
  upsert(account: ProviderCreditAccount): void;
  list(): ProviderCreditAccount[];
  check(providerId: string, requiredUsd?: number, now?: Date): CreditCheck;
  reserve(providerId: string, amountUsd: number, id?: string, now?: Date): CreditReservation;
  consume(reservationId: string): CreditReservation;
  release(reservationId: string): CreditReservation;
}

export function createCreditLedger(initial: ProviderCreditAccount[] = []): CreditLedger {
  const accounts = new Map(initial.map((a) => [a.providerId, { ...a }]));
  const reservations = new Map<string, CreditReservation>();

  const check = (providerId: string, requiredUsd = 0, now = new Date()): CreditCheck => {
    const account = accounts.get(providerId);
    if (!account || !account.enabled) return { providerId, status: 'disabled', availableUsd: 0, reason: 'credit_account_disabled_or_missing' };
    const availableUsd = Math.max(0, account.balanceUsd - account.reservedUsd);
    if (account.expiresAt && new Date(account.expiresAt).getTime() <= now.getTime()) return { providerId, status: 'expired', availableUsd, expiresAt: account.expiresAt, reason: 'credit_expired' };
    if (availableUsd <= 0 || availableUsd < requiredUsd) return { providerId, status: 'exhausted', availableUsd, expiresAt: account.expiresAt, reason: 'insufficient_credit' };
    return { providerId, status: 'available', availableUsd, expiresAt: account.expiresAt, reason: 'credit_available' };
  };

  return {
    get: (providerId) => accounts.get(providerId),
    upsert: (account) => accounts.set(account.providerId, { ...account }),
    list: () => [...accounts.values()].map((a) => ({ ...a })),
    check,
    reserve: (providerId, amountUsd, id = `credit-${Date.now()}-${Math.random().toString(36).slice(2)}`, now = new Date()) => {
      if (amountUsd < 0) throw new Error('credit_amount_must_be_non_negative');
      const result = check(providerId, amountUsd, now);
      if (result.status !== 'available') throw new Error(result.reason);
      const account = accounts.get(providerId)!;
      account.reservedUsd += amountUsd;
      const reservation: CreditReservation = { id, providerId, amountUsd, createdAt: now.toISOString(), status: 'reserved' };
      reservations.set(id, reservation);
      return { ...reservation };
    },
    consume: (reservationId) => {
      const reservation = reservations.get(reservationId);
      if (!reservation || reservation.status !== 'reserved') throw new Error('invalid_credit_reservation');
      const account = accounts.get(reservation.providerId)!;
      account.reservedUsd = Math.max(0, account.reservedUsd - reservation.amountUsd);
      account.balanceUsd = Math.max(0, account.balanceUsd - reservation.amountUsd);
      reservation.status = 'consumed';
      return { ...reservation };
    },
    release: (reservationId) => {
      const reservation = reservations.get(reservationId);
      if (!reservation || reservation.status !== 'reserved') throw new Error('invalid_credit_reservation');
      const account = accounts.get(reservation.providerId)!;
      account.reservedUsd = Math.max(0, account.reservedUsd - reservation.amountUsd);
      reservation.status = 'released';
      return { ...reservation };
    },
  };
}
