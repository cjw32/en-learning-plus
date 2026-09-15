import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { digestQueueName } from './digest.queue';
import { DigestService } from './digest.service';
import { EmailService } from '@libs/shared';
@Processor(digestQueueName.name)
export class DigestProcessor extends WorkerHost {
  constructor(
    private readonly digestService: DigestService,
    private readonly emailService: EmailService,
  ) {
    super();
  }
  async process(job: Job) {
    if (job.name === digestQueueName.task.emailDigest) {
      const digest = await this.digestService.prepareEmailDigest(job.data);
      if (!digest) return;
      const sent = await this.emailService.sendEmail(
        digest.email,
        '每日单词记忆报告',
        digest.text,
      );
      if (sent === false) throw new Error('Digest delivery failed');
    }
    if (job.name === digestQueueName.task.everyDayDigest) {
      await this.digestService.handleEmailDigest();
      console.log('每天任务消费成功');
    }
  }
}
