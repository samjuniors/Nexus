import type { IncomingMessage, ServerResponse } from 'node:http';

export interface NexusOwnerGateway {
  /** Server binds to loopback only. Reverse proxies must terminate TLS. */
  bindHost: string;
  requiresOwnerToken: boolean;
  guardHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  guardUpgrade(req: IncomingMessage, pathname: string): boolean;
}

export function createOwnerGateway(options?: {
  env?: NodeJS.ProcessEnv;
  port?: number;
}): NexusOwnerGateway;
