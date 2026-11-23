import type { IncomingMessage, ServerResponse } from 'node:http';
import type WebSocket from 'ws';

export interface NexusOwnerGateway {
  /** Server binds to loopback only. Reverse proxies must terminate TLS. */
  bindHost: string;
  requiresOwnerToken: boolean;
  guardHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  guardUpgrade(req: IncomingMessage, pathname: string): boolean;
  registerOwnerSocket(ws: WebSocket, req: IncomingMessage): void;
}

export function createOwnerGateway(options?: {
  env?: NodeJS.ProcessEnv;
  port?: number;
}): NexusOwnerGateway;
