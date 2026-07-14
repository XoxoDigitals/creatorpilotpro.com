import type { FastifyRequest } from 'fastify';
import type { Role } from '@scp/db';

/** The authenticated principal attached to a request by SessionAuthGuard. */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

/** Fastify request augmented with the resolved session user + session id. */
export interface AuthedRequest extends FastifyRequest {
  user?: SessionUser;
  sessionId?: string;
}

/** Name of the HttpOnly session cookie (signed). */
export const SESSION_COOKIE = 'scp_session';
