import { Injectable } from '@nestjs/common';
import { McpRetentionService } from './mcp-retention.service';

/** Called by an existing approved scheduler; importing this class never enables a job. */
@Injectable()
export class McpRetentionProcessor {
  constructor(private readonly retention: McpRetentionService) {}
  runOnce(now = new Date()) {
    return this.retention.run(now);
  }
}
