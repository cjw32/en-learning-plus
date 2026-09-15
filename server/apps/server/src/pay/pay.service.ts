import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreatePayDto } from '@en/common/pay';
import type { TokenPayload } from '@en/common/user';
import {
  PrismaService,
  PayService as SharedPayService,
  ResponseService,
} from '@libs/shared';
import { nanoid } from 'nanoid';
import dayjs from 'dayjs';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TradeStatus } from '@libs/shared/generated/prisma/enums';
import { SocketGateway } from '../socket/socket.gateway';

type OrderSnapshot = {
  version: 1;
  courseId: string;
  userId: string;
  amount: string;
};

@Injectable()
export class PayService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly sharedPayService: SharedPayService,
    private readonly responseService: ResponseService,
    private readonly configService: ConfigService,
    private readonly socketGateway: SocketGateway,
  ) {}

  private snapshotSignature(snapshot: OrderSnapshot): string {
    const secret = this.configService.get<string>('SECRET_KEY');
    if (!secret) throw new Error('Payment snapshot signing is not configured');
    return createHmac('sha256', secret)
      .update(
        JSON.stringify([
          snapshot.version,
          snapshot.courseId,
          snapshot.userId,
          snapshot.amount,
        ]),
      )
      .digest('hex');
  }

  private readSnapshot(body: string): OrderSnapshot {
    try {
      const { snapshot, signature } = JSON.parse(body);
      if (
        snapshot?.version !== 1 ||
        typeof snapshot.courseId !== 'string' ||
        !snapshot.courseId ||
        typeof snapshot.userId !== 'string' ||
        !snapshot.userId ||
        typeof snapshot.amount !== 'string' ||
        !/^\d+\.\d{2}$/.test(snapshot.amount) ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(
          Buffer.from(signature, 'hex'),
          Buffer.from(this.snapshotSignature(snapshot), 'hex'),
        )
      ) {
        throw new Error('Invalid snapshot');
      }
      return snapshot;
    } catch {
      throw new BadRequestException('订单缺少可信课程快照，请联系支持核对');
    }
  }

  async create(dto: CreatePayDto, user: TokenPayload) {
    if (typeof dto?.courseId !== 'string' || !dto.courseId.trim()) {
      throw new BadRequestException('课程参数无效');
    }
    const course = await this.prismaService.course.findUnique({
      where: { id: dto.courseId },
    });
    if (!course) throw new BadRequestException('课程不存在');
    if (
      !course.price.isFinite() ||
      course.price.lte(0) ||
      course.price.decimalPlaces() > 2
    ) {
      throw new BadRequestException('课程价格无效');
    }
    const owned = await this.prismaService.courseRecord.findFirst({
      where: { courseId: course.id, userId: user.userId, isPurchased: true },
    });
    if (owned) throw new BadRequestException('课程已购买');

    const snapshot: OrderSnapshot = {
      version: 1,
      courseId: course.id,
      userId: user.userId,
      amount: course.price.toFixed(2),
    };
    const outTradeNo = `CJW-${nanoid(12)}`;
    const expiresAt = dayjs().add(5, 'minute');
    const payUrl = this.sharedPayService
      .getAlipaySdk()
      .pageExecute('alipay.trade.page.pay', 'GET', {
        bizContent: {
          out_trade_no: outTradeNo,
          total_amount: snapshot.amount,
          subject: course.name,
          product_code: 'FAST_INSTANT_TRADE_PAY',
          time_expire: expiresAt.format('YYYY-MM-DD HH:mm:ss'),
        },
        notify_url: `${this.configService.get<string>('ALIPAY_NOTIFY_URL')!}/api/v1/pay/notify`,
        return_url: `${this.configService.get<string>('ALIPAY_NOTIFY_URL')!}/`,
      });
    await this.prismaService.paymentRecord.create({
      data: {
        userId: user.userId,
        outTradeNo,
        amount: snapshot.amount,
        subject: course.name,
        body: JSON.stringify({
          snapshot,
          signature: this.snapshotSignature(snapshot),
        }),
      },
    });
    return this.responseService.success({
      payUrl,
      timeExpire: expiresAt.valueOf(),
    });
  }

  async notify(req: Pick<Request, 'body'>): Promise<void> {
    const body = req.body;
    let verified = false;
    try {
      verified =
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        typeof body.sign === 'string' &&
        body.sign_type === 'RSA2' &&
        this.sharedPayService.getAlipaySdk().checkNotifySignV2(body);
    } catch {
      /* Malformed signatures fail closed. */
    }
    const appId = this.configService.get<string>('ALIPAY_APP_ID');
    const sellerId = this.configService.get<string>('ALIPAY_SELLER_ID');
    if (
      !verified ||
      !appId ||
      body.app_id !== appId ||
      (sellerId && body.seller_id !== sellerId) ||
      !['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(body.trade_status) ||
      typeof body.out_trade_no !== 'string' ||
      typeof body.trade_no !== 'string' ||
      !body.trade_no ||
      typeof body.total_amount !== 'string' ||
      !/^\d+(?:\.\d{1,2})?$/.test(body.total_amount) ||
      typeof body.gmt_payment !== 'string'
    ) {
      throw new BadRequestException('支付通知无效');
    }
    const paidAt = dayjs(body.gmt_payment);
    if (!paidAt.isValid()) throw new BadRequestException('支付时间无效');
    const completedUser = await this.prismaService.$transaction(async (tx) => {
      const order = await tx.paymentRecord.findUnique({
        where: { outTradeNo: body.out_trade_no },
      });
      if (!order) throw new BadRequestException('订单不存在');
      const snapshot = this.readSnapshot(order.body);
      if (
        snapshot.userId !== order.userId ||
        !order.amount.eq(snapshot.amount) ||
        !order.amount.eq(body.total_amount)
      )
        throw new BadRequestException('支付订单不匹配');
      if (order.tradeStatus === TradeStatus.TRADE_SUCCESS) {
        if (order.tradeNo !== body.trade_no)
          throw new BadRequestException('支付流水不匹配');
        return null;
      }
      const changed = await tx.paymentRecord.updateMany({
        where: { id: order.id, tradeStatus: TradeStatus.NOT_PAY },
        data: {
          tradeNo: body.trade_no,
          tradeStatus: TradeStatus.TRADE_SUCCESS,
          sendPayTime: paidAt.toDate(),
        },
      });
      if (!changed.count) {
        const current = await tx.paymentRecord.findUnique({
          where: { id: order.id },
        });
        if (
          current?.tradeStatus === TradeStatus.TRADE_SUCCESS &&
          current.tradeNo === body.trade_no
        )
          return null;
        throw new BadRequestException('订单状态不允许支付');
      }
      await tx.courseRecord.upsert({
        where: {
          userId_courseId: {
            userId: order.userId,
            courseId: snapshot.courseId,
          },
        },
        create: {
          userId: order.userId,
          courseId: snapshot.courseId,
          isPurchased: true,
          paymentRecordId: order.id,
        },
        update: { isPurchased: true, paymentRecordId: order.id },
      });
      return order.userId;
    });
    // Entitlement is already committed; a transient websocket failure must not fail the callback.
    if (completedUser) {
      try {
        this.socketGateway.emitPaymentSuccess(completedUser);
      } catch {
        /* Re-querying owned courses remains authoritative. */
      }
    }
  }
}
