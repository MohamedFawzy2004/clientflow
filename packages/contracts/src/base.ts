// Shared request/response contracts for the ClientFlow API and web app.
// The API validates every request with these schemas. The web app reuses them for form validation.
import { z } from 'zod';

export const ROLES = [
  'OWNER',
  'ADMIN',
  'SALES_MANAGER',
  'SALES',
  'PM',
  'MEMBER',
  'FINANCE',
  'CLIENT',
] as const;
export type Role = (typeof ROLES)[number];

export const CONTACT_LIFECYCLES = ['LEAD', 'CUSTOMER'] as const;
export type ContactLifecycle = (typeof CONTACT_LIFECYCLES)[number];

export const CONTACT_SOURCES = [
  'REFERRAL',
  'WEBSITE',
  'SOCIAL',
  'EVENT',
  'OUTBOUND',
  'PARTNER',
  'OTHER',
] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  REFERRAL: 'Referral',
  WEBSITE: 'Website',
  SOCIAL: 'Social media',
  EVENT: 'Event',
  OUTBOUND: 'Outbound',
  PARTNER: 'Partner',
  OTHER: 'Other',
};

export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const NOTES_MAX_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT_STALE_VERSION'
  | 'CONFLICT'
  | 'TOKEN_INVALID'
  | 'MALFORMED_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors: Record<string, string[]>;
    requestId: string;
  };
}

export interface ApiSuccess<T, M extends object = object> {
  data: T;
  meta: { requestId: string } & M;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const emailField = z
  .string()
  .trim()
  .min(1, 'Enter an email address.')
  .max(254, 'Email must be 254 characters or fewer.')
  .pipe(z.email({ message: 'Enter a valid email address.' }));

export const loginRequestSchema = z
  .object({
    email: emailField,
    // Length checks only. Strength rules apply when a password is set, not at login.
    password: z
      .string()
      .min(1, 'Enter your password.')
      .max(PASSWORD_MAX_LENGTH, 'Password is too long.'),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  agency: {
    id: string;
    name: string;
    defaultCurrency: string;
    timezone: string;
    /** A demo workspace with fictional data only (ADR-066). */
    isDemo: boolean;
  };
  /** CLIENT users only: the organization they belong to. */
  clientOrg: { id: string; name: string } | null;
}

export interface LoginResponse {
  user: SessionUser;
  csrfToken: string;
}

// ---------------------------------------------------------------------------
// Contacts / leads
// ---------------------------------------------------------------------------

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Accepts digits, spaces, dashes, dots, parentheses and one leading +. 6–15 digits in total. */
export const PHONE_PATTERN = /^\+?[0-9\s().-]{6,30}$/;

export const contactCreateSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, 'Enter the lead’s name.')
      .max(200, 'Name must be 200 characters or fewer.'),
    email: z
      .union([z.literal(''), emailField])
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    phone: z
      .string()
      .trim()
      .max(30, 'Phone number is too long.')
      .optional()
      .transform((v) => (v === '' ? undefined : v))
      .refine((v) => v === undefined || PHONE_PATTERN.test(v), {
        message: 'Use digits, spaces, dashes or a leading +.',
      })
      .refine(
        (v) => {
          if (v === undefined) return true;
          const digits = v.replace(/\D/g, '');
          return digits.length >= 6 && digits.length <= 15;
        },
        { message: 'Phone number must contain 6 to 15 digits.' },
      ),
    companyName: optionalText(200, 'Company'),
    source: z.enum(CONTACT_SOURCES, { message: 'Choose a source from the list.' }).optional(),
    lifecycle: z.enum(CONTACT_LIFECYCLES).optional(),
    nextActionAt: z
      .union([z.literal(''), z.iso.datetime({ offset: true, message: 'Enter a valid date.' })])
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    notes: optionalText(NOTES_MAX_LENGTH, 'Notes'),
  })
  // Unknown keys (ownerId, agencyId, role, ...) are rejected: no mass assignment (T-ACL-03).
  .strict();
export type ContactCreateInput = z.input<typeof contactCreateSchema>;
export type ContactCreate = z.output<typeof contactCreateSchema>;

export const contactListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
    q: z.string().trim().max(100).optional(),
    lifecycle: z.enum(CONTACT_LIFECYCLES).optional(),
  })
  .strict();
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export interface ContactSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  lifecycle: ContactLifecycle;
  source: ContactSource | null;
  owner: { id: string; name: string };
  nextActionAt: string | null;
  convertedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ActivityItem {
  id: string;
  eventType: string;
  summary: string;
  /** Free text of notes and logged interactions. Always rendered as plain text. */
  body: string | null;
  actor: { id: string; name: string } | null;
  occurredAt: string;
  createdAt: string;
}

export interface ContactDetail extends ContactSummary {
  notes: string | null;
  activities: ActivityItem[];
}

export interface PossibleDuplicate {
  id: string;
  fullName: string;
  matchedOn: Array<'email' | 'phone'>;
}

export interface ContactCreateMeta {
  possibleDuplicates: PossibleDuplicate[];
}

// ---------------------------------------------------------------------------
// Passwords, invitations, password reset, team (M2)
// ---------------------------------------------------------------------------

/** Shape rules only. The server also rejects common and breached passwords (SEC-03). */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

/** Opaque one-time tokens are base64url, 43 characters for 32 random bytes. */
const tokenField = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/, 'This link is not valid.');

const staffRoleEnum = z.enum(
  ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE'],
  { message: 'Choose a role from the list.' },
);

export const invitationCreateSchema = z.object({ email: emailField, role: staffRoleEnum }).strict();
export type InvitationCreate = z.infer<typeof invitationCreateSchema>;

export const invitationTokenSchema = z.object({ token: tokenField }).strict();

export const invitationAcceptSchema = z
  .object({
    token: tokenField,
    name: z
      .string()
      .trim()
      .min(1, 'Enter your name.')
      .max(120, 'Name must be 120 characters or fewer.'),
    password: newPasswordSchema,
  })
  .strict();
export type InvitationAccept = z.infer<typeof invitationAcceptSchema>;

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string };
}

export interface InvitationCreated {
  invitation: InvitationSummary;
  /** Shown once to the inviter so the invite works even without email delivery. */
  acceptUrl: string;
  emailDelivery: 'sent_to_dev_sink' | 'disabled';
}

export interface InvitationPreview {
  email: string;
  role: Role;
  agencyName: string;
  /** Portal invitations: the client organization the person will belong to. */
  clientOrgName: string | null;
  expiresAt: string;
}

export const passwordResetRequestSchema = z.object({ email: emailField }).strict();
export const passwordResetConfirmSchema = z
  .object({ token: tokenField, password: newPasswordSchema })
  .strict();

export type MemberStatus = 'ACTIVE' | 'DEACTIVATED';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  lastLoginAt: string | null;
  activeSessions: number;
  createdAt: string;
  version: number;
  isSelf: boolean;
}

export const memberUpdateSchema = z
  .object({ role: staffRoleEnum, version: z.number().int().positive() })
  .strict();
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

export const memberActionSchema = z.object({ version: z.number().int().positive() }).strict();
