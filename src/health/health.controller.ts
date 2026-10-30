import { Controller, Get, Header } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Liveness probe: answers 200 while the process can serve requests.
 * It deliberately does not touch MongoDB. Dependency checks belong to
 * GET /ready (Step 2), so a database blip does not get the container restarted.
 */
@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  check(): HealthResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
