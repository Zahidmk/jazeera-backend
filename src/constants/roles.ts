import { Role } from '@prisma/client';

/** Every role the system knows about — derived from the Prisma enum so it never drifts. */
export const ALL_ROLES: string[] = Object.values(Role);

export const isValidRole = (value: unknown): value is string =>
  typeof value === 'string' && ALL_ROLES.includes(value);

/** Back-office roles: dashboard, user management, Odoo sync/inspection. */
export const BACKOFFICE_ROLES = ['ADMIN', 'MANAGER'];

/** Roles allowed on the Merchandiser mobile API. Deliberately Merchandiser-only: the data is scoped to the caller, so admins use the /admin/* views instead. */
export const MERCHANDISER_APP_ROLES = ['MERCHANDISER'];

/** Roles allowed on /driver/* and /driver/sales/* (van-sales workflow). Admin/Manager kept for support & testing. */
export const DRIVER_APP_ROLES = ['DRIVER', 'ADMIN', 'MANAGER'];
