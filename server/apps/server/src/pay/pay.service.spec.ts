import { createSign, generateKeyPairSync } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import { Prisma } from '@libs/shared/generated/prisma/client';
import { PayService } from './pay.service';
import { PayController } from './pay.controller';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const sdk = new AlipaySdk({
  appId: 'app',
  privateKey: keys.privateKey,
  alipayPublicKey: keys.publicKey,
});
function signed(overrides: Record<string, string> = {}) {
  const data = {
    app_id: 'app',
    seller_id: 'seller',
    sign_type: 'RSA2',
    trade_status: 'TRADE_SUCCESS',
    out_trade_no: '',
    trade_no: 'trade-1',
    total_amount: '12.30',
    gmt_payment: '2026-09-14 10:00:00',
    ...overrides,
  };
  const text = Object.keys(data)
    .filter((key) => key !== 'sign_type')
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('&');
  return {
    ...data,
    sign: createSign('RSA-SHA256').update(text).sign(keys.privateKey, 'base64'),
  };
}
function fixture() {
  let order: any;
  const pageExecute = jest.fn(() => 'https://pay.example');
  const prisma = {
    course: {
      findUnique: jest.fn(async () => ({
        id: 'course',
        name: 'Real course',
        price: new Prisma.Decimal('12.30'),
      })),
    },
    courseRecord: {
      findFirst: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
    },
    paymentRecord: {
      create: jest.fn(async ({ data }) => {
        order = {
          id: 'payment',
          ...data,
          amount: new Prisma.Decimal(data.amount),
          tradeStatus: 'NOT_PAY',
        };
        return order;
      }),
      findUnique: jest.fn(async () => (order ? { ...order } : null)),
      updateMany: jest.fn(async ({ data }) => {
        if (order.tradeStatus !== 'NOT_PAY') return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      }),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  };
  const socket = { emitPaymentSuccess: jest.fn() };
  const service = new PayService(
    prisma as any,
    {
      getAlipaySdk: () => ({
        pageExecute,
        checkNotifySignV2: sdk.checkNotifySignV2.bind(sdk),
      }),
    } as any,
    { success: (data) => data } as any,
    {
      get: (key) =>
        ({
          SECRET_KEY: 'test-only-secret',
          ALIPAY_APP_ID: 'app',
          ALIPAY_SELLER_ID: 'seller',
          ALIPAY_NOTIFY_URL: 'https://example.test',
        })[key],
    } as any,
    socket as any,
  );
  const create = () =>
    service.create(
      {
        courseId: 'course',
        subject: 'fake',
        body: '{"userId":"victim"}',
        total_amount: 0.01,
      } as any,
      { userId: 'owner' } as any,
    );
  return {
    service,
    prisma,
    pageExecute,
    socket,
    create,
    order: () => order,
    callback: (overrides = {}) =>
      signed({ out_trade_no: order.outTradeNo, ...overrides }),
  };
}

describe('Payment trust boundary', () => {
  it('uses database price/title and persists authenticated ownership', async () => {
    const f = fixture();
    await f.create();
    expect(f.pageExecute.mock.calls[0][2].bizContent).toMatchObject({
      total_amount: '12.30',
      subject: 'Real course',
    });
    expect(JSON.parse(f.order().body).snapshot).toEqual({
      version: 1,
      userId: 'owner',
      courseId: 'course',
      amount: '12.30',
    });
  });
  it.each([
    { total_amount: '0.01' },
    { app_id: 'other' },
    { seller_id: 'other' },
    { trade_status: 'WAIT_BUYER_PAY' },
    { trade_status: 'TRADE_CLOSED' },
    { gmt_payment: 'invalid' },
    { total_amount: 'NaN' },
  ])('rejects signed but mismatched notifications %j', async (overrides) => {
    const f = fixture();
    await f.create();
    await expect(
      f.service.notify({ body: f.callback(overrides) }),
    ).rejects.toThrow();
    expect(f.prisma.courseRecord.upsert).not.toHaveBeenCalled();
  });
  it('rejects unsigned and signature-tampered notifications', async () => {
    const f = fixture();
    await f.create();
    await expect(
      f.service.notify({ body: { ...f.callback(), sign: '' } }),
    ).rejects.toThrow();
    await expect(
      f.service.notify({ body: { ...f.callback(), body: 'tampered' } }),
    ).rejects.toThrow();
    expect(f.prisma.paymentRecord.updateMany).not.toHaveBeenCalled();
  });
  it('ignores callback ownership and grants the order owner exactly once on concurrent replay', async () => {
    const f = fixture();
    await f.create();
    const body = f.callback({ body: '{"userId":"victim","courseId":"other"}' });
    await Promise.all([f.service.notify({ body }), f.service.notify({ body })]);
    await f.service.notify({ body });
    expect(f.prisma.courseRecord.upsert).toHaveBeenCalledTimes(1);
    expect(f.prisma.courseRecord.upsert.mock.calls[0][0]).toMatchObject({
      create: {
        userId: 'owner',
        courseId: 'course',
        paymentRecordId: 'payment',
      },
      update: { paymentRecordId: 'payment', isPurchased: true },
    });
    expect(f.socket.emitPaymentSuccess).toHaveBeenCalledTimes(1);
    await expect(
      f.service.notify({ body: f.callback({ trade_no: 'another' }) }),
    ).rejects.toThrow();
  });
  it('rejects unsigned legacy or modified stored order snapshots', async () => {
    const f = fixture();
    await f.create();
    const snapshot = JSON.parse(f.order().body);
    snapshot.snapshot.courseId = 'other';
    f.order().body = JSON.stringify(snapshot);
    await expect(f.service.notify({ body: f.callback() })).rejects.toThrow();
    f.order().body = '{"userId":"owner","courseId":"course"}';
    await expect(f.service.notify({ body: f.callback() })).rejects.toThrow();
    expect(f.prisma.courseRecord.upsert).not.toHaveBeenCalled();
  });
  it('returns a plain provider acknowledgement and handles failures', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const controller = new PayController({ notify } as any);
    const res = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    await controller.notify({} as any, res as any);
    expect(res.send).toHaveBeenLastCalledWith('success');
    notify.mockRejectedValue(new Error('DB unavailable'));
    await controller.notify({} as any, res as any);
    expect(res.status).toHaveBeenLastCalledWith(500);
    expect(res.send).toHaveBeenLastCalledWith('failure');
  });
});
