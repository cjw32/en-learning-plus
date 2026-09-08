import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService, ResponseService } from '@libs/shared';
import { InterceptorExceptionFilter } from '@libs/shared/interceptor/exceptionFilter';
import { InterceptorInterceptor } from '@libs/shared/interceptor/interceptor';
import { MinioService } from '@libs/shared/minio/minio.service';
import { PayService as SharedPayService } from '@libs/shared/pay/pay.service';
import { ChatController } from '../../ai/src/chat/chat.controller';
import { ChatService } from '../../ai/src/chat/chat.service';
import { PromptController } from '../../ai/src/prompt/prompt.controller';
import { PromptService } from '../../ai/src/prompt/prompt.service';

const FIXTURE_PREFIX = 'legacy-regression-';
const describeWithDisposableDatabase = process.env.COACH_E2E_DATABASE_URL
  ? describe
  : describe.skip;

function assertDisposableDatabase(): string {
  const databaseUrl = process.env.COACH_E2E_DATABASE_URL;
  if (
    !databaseUrl ||
    !/(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ||
    !/test/i.test(databaseUrl) ||
    /(?:prod|production)/i.test(databaseUrl)
  ) {
    throw new Error(
      'COACH_E2E_DATABASE_URL must be a localhost disposable test database',
    );
  }
  return databaseUrl;
}

function configureHttpApp(app: INestApplication, prefix: string): void {
  app.useGlobalInterceptors(new InterceptorInterceptor());
  app.useGlobalFilters(new InterceptorExceptionFilter());
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}

describeWithDisposableDatabase(
  'existing public learning flows regression (isolated database)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
      process.env.DATABASE_URL = assertDisposableDatabase();
      process.env.SECRET_KEY = 'legacy-regression-test-secret';
      process.env.REDIS_HOST = process.env.COACH_E2E_REDIS_HOST ?? '127.0.0.1';
      process.env.REDIS_PORT = process.env.COACH_E2E_REDIS_PORT ?? '56379';
      process.env.MINIO_ENDPOINT = '127.0.0.1';
      process.env.MINIO_PORT = '59000';
      process.env.MINIO_USE_SSL = '0';
      process.env.MINIO_ACCESS_KEY = 'test-access';
      process.env.MINIO_SECRET_KEY = 'test-secret';
      process.env.MINIO_BUCKET = 'test-avatar';

      const { AppModule } =
        require('../src/app.module') as typeof import('../src/app.module');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MinioService)
        .useValue({
          getClient: () => ({ putObject: jest.fn() }),
          getBucket: () => 'test-avatar',
        })
        .overrideProvider(SharedPayService)
        .useValue({ getAlipaySdk: jest.fn() })
        .compile();

      app = moduleRef.createNestApplication();
      configureHttpApp(app, 'api');
      await app.init();
      prisma = app.get(PrismaService);

      await prisma.user.deleteMany({
        where: { phone: { startsWith: FIXTURE_PREFIX } },
      });
      await prisma.course.deleteMany({
        where: { id: { startsWith: FIXTURE_PREFIX } },
      });
      await prisma.wordBook.deleteMany({
        where: { id: { startsWith: FIXTURE_PREFIX } },
      });
    }, 30_000);

    afterAll(async () => {
      if (prisma) {
        await prisma.user.deleteMany({
          where: { phone: { startsWith: FIXTURE_PREFIX } },
        });
        await prisma.course.deleteMany({
          where: { id: { startsWith: FIXTURE_PREFIX } },
        });
        await prisma.wordBook.deleteMany({
          where: { id: { startsWith: FIXTURE_PREFIX } },
        });
        await prisma.$disconnect();
      }
      await app?.close();
    });

    it('preserves login/refresh, dictionary, purchased course, ten-word and batch-master behavior', async () => {
      const phone = `${FIXTURE_PREFIX}phone`;
      const password = 'test-password';
      const registration = await request(app.getHttpServer())
        .post('/api/v1/user/register')
        .send({
          name: 'Legacy Regression Learner',
          email: 'legacy-regression@example.test',
          phone,
          password,
        })
        .expect(201);

      expect(registration.body).toMatchObject({
        success: true,
        data: {
          name: 'Legacy Regression Learner',
          phone,
          wordNumber: 0,
          token: {
            accessToken: expect.any(String),
            refreshToken: expect.any(String),
          },
        },
      });
      expect(registration.body.data).not.toHaveProperty('password');

      const login = await request(app.getHttpServer())
        .post('/api/v1/user/login')
        .send({ phone, password })
        .expect(201);
      expect(login.body.success).toBe(true);
      const userId = login.body.data.id as string;
      const refreshToken = login.body.data.token.refreshToken as string;

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/user/refresh-token')
        .send({ refreshToken })
        .expect(201);
      expect(refreshed.body).toMatchObject({
        success: true,
        data: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
      });
      const accessToken = refreshed.body.data.accessToken as string;

      const courseId = `${FIXTURE_PREFIX}course`;
      await prisma.course.create({
        data: {
          id: courseId,
          name: 'Legacy CET4',
          value: 'cet4',
          description: 'Synthetic regression course',
          teacher: 'Test Teacher',
          url: '/test-course.png',
          price: 9.9,
        },
      });
      const payment = await prisma.paymentRecord.create({
        data: {
          id: `${FIXTURE_PREFIX}payment`,
          userId,
          outTradeNo: `${FIXTURE_PREFIX}trade`,
          amount: 9.9,
          subject: 'Legacy CET4',
          body: 'Synthetic regression purchase',
          tradeStatus: 'TRADE_SUCCESS',
        },
      });
      await prisma.courseRecord.create({
        data: {
          id: `${FIXTURE_PREFIX}course-record`,
          userId,
          courseId,
          isPurchased: true,
          paymentRecordId: payment.id,
        },
      });
      const words = Array.from({ length: 12 }, (_, index) => ({
        id: `${FIXTURE_PREFIX}word-${String(index + 1).padStart(2, '0')}`,
        word: `regressionword${String(index + 1).padStart(2, '0')}`,
        definition: `definition ${index + 1}`,
        translation: `translation ${index + 1}`,
        frq: String(100 - index).padStart(3, '0'),
        cet4: true,
      }));
      await prisma.wordBook.createMany({ data: words });

      const dictionary = await request(app.getHttpServer())
        .get('/api/v1/word-book')
        .query({ word: 'regressionword', page: 1, pageSize: 12 })
        .expect(200);
      expect(dictionary.body).toMatchObject({
        success: true,
        data: { total: 12, list: expect.any(Array) },
      });
      expect(dictionary.body.data.list).toHaveLength(12);

      const publicCourses = await request(app.getHttpServer())
        .get('/api/v1/course/list')
        .expect(200);
      expect(publicCourses.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: courseId, price: '9.90' }),
        ]),
      );

      await request(app.getHttpServer()).get('/api/v1/course/my').expect(401);
      const myCourses = await request(app.getHttpServer())
        .get('/api/v1/course/my')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(myCourses.body.data).toEqual([
        expect.objectContaining({ id: courseId, price: '9.90' }),
      ]);

      const learn = await request(app.getHttpServer())
        .get(`/api/v1/learn/word/${courseId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(learn.body.data).toHaveLength(10);
      const learnedIds = learn.body.data.map((word: { id: string }) => word.id);

      const firstSave = await request(app.getHttpServer())
        .post('/api/v1/learn/word/master')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ wordIds: learnedIds })
        .expect(201);
      expect(firstSave.body.data).toEqual({ wordNumber: 10 });

      const replay = await request(app.getHttpServer())
        .post('/api/v1/learn/word/master')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ wordIds: [...learnedIds, learnedIds[0]] })
        .expect(201);
      expect(replay.body.data).toEqual({ wordNumber: 10 });

      const [legacyRecords, reviewStates, learner] = await Promise.all([
        prisma.wordBookRecord.count({ where: { userId } }),
        prisma.learningItemState.count({
          where: { userId, targetType: 'WORD' },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      ]);
      expect({
        legacyRecords,
        reviewStates,
        wordNumber: learner.wordNumber,
      }).toEqual({
        legacyRecords: 10,
        reviewStates: 10,
        wordNumber: 10,
      });
    }, 30_000);
  },
);

describe('existing generic AI HTTP contract regression', () => {
  let app: INestApplication;
  const chatService = {
    streamCompletion: jest.fn(async () =>
      (async function* () {
        yield [
          {
            content: 'legacy-ai-ok',
            additional_kwargs: {},
          },
        ];
      })(),
    ),
    findAll: jest.fn(async () => ({
      data: [],
      code: 0,
      message: 'Success',
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PromptController, ChatController],
      providers: [
        PromptService,
        ResponseService,
        { provide: ChatService, useValue: chatService },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttpApp(app, 'ai');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the five public modes and the legacy history/SSE routes', async () => {
    const modes = await request(app.getHttpServer())
      .get('/ai/v1/prompt/list')
      .expect(200);
    expect(modes.body.data).toHaveLength(5);
    expect(modes.body.data).toEqual(
      expect.arrayContaining([
        { id: '1', label: '💬 智能助手', role: 'normal' },
        { id: '2', label: '🎓 英语大师', role: 'master' },
      ]),
    );
    expect(JSON.stringify(modes.body.data)).not.toContain('prompt');

    const history = await request(app.getHttpServer())
      .get('/ai/v1/chat/history')
      .query({ userId: 'legacy-regression-user', role: 'normal' })
      .expect(200);
    expect(history.body).toMatchObject({ success: true, data: [] });

    const streamed = await request(app.getHttpServer())
      .post('/ai/v1/chat')
      .send({
        userId: 'legacy-regression-user',
        role: 'normal',
        content: 'hello',
        deepThink: false,
        webSearch: false,
      })
      .expect(201)
      .expect('Content-Type', /text\/event-stream/);
    expect(streamed.text).toContain('legacy-ai-ok');
    expect(chatService.streamCompletion).toHaveBeenCalledTimes(1);
  });
});
