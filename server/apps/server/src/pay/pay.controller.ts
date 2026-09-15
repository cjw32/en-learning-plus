import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  HttpException,
} from '@nestjs/common';
import { PayService } from './pay.service';
import type { CreatePayDto } from '@en/common/pay';
import { AuthGuard } from '@libs/shared/auth/auth.guard';
import type { Request, Response } from 'express';
@Controller('pay')
export class PayController {
  constructor(private readonly payService: PayService) {}

  @UseGuards(AuthGuard)
  @Post('create')
  create(@Body() createPayDto: CreatePayDto, @Req() req: Request) {
    const user = req.user;
    return this.payService.create(createPayDto, user);
  }

  @Post('notify')
  async notify(@Req() req: Request, @Res() res: Response) {
    try {
      await this.payService.notify(req);
      res.status(200).type('text/plain').send('success');
    } catch (error) {
      res
        .status(error instanceof HttpException ? error.getStatus() : 500)
        .type('text/plain')
        .send('failure');
    }
  }
}
