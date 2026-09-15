import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { AlipaySdk } from 'alipay-sdk';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class PayService implements OnModuleInit {
  constructor(private configService: ConfigService) {}
  public alipaySdk: AlipaySdk;
  onModuleInit() {
    // Optional integration: missing payment credentials must not stop learning services.
    if (!this.configService.get<string>('ALIPAY_APP_ID') ||
        !this.configService.get<string>('ALIPAY_PRIVATE_KEY') ||
        !this.configService.get<string>('ALIPAY_PUBLIC_KEY')) return;
    // TODO: 初始化支付服务
    this.alipaySdk = new AlipaySdk({
      appId: this.configService.get<string>('ALIPAY_APP_ID')!,
      privateKey: this.configService.get<string>('ALIPAY_PRIVATE_KEY')!,
      alipayPublicKey: this.configService.get<string>('ALIPAY_PUBLIC_KEY')!,
      gateway: this.configService.get<string>('ALIPAY_GATEWAY')!,
    });
  }
  getAlipaySdk() {
    if (!this.alipaySdk) throw new ServiceUnavailableException('支付服务尚未配置');
    return this.alipaySdk;
  }
}
