import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { LearnService } from './learn.service';
import { CreateLearnDto } from './dto/create-learn.dto';
import { UpdateLearnDto } from './dto/update-learn.dto';
import { AuthGuard } from '@libs/shared/auth/auth.guard';
import type { Request } from 'express';
@Controller('learn')
export class LearnController {
  constructor(private readonly learnService: LearnService) {}

  @UseGuards(AuthGuard)
  @Get('stats')
  getStudyStats(@Req() req: Request) {
    return this.learnService.getStudyStats(req.user.userId);
  }

  @UseGuards(AuthGuard)
  @Post('word/master')
  saveWordMaster(
    @Body() { wordIds }: { wordIds: string[] },
    @Req() req: Request,
  ) {
    const userId = req.user.userId;
    return this.learnService.saveWordMaster(wordIds, userId);
  }

  @UseGuards(AuthGuard)
  @Get('word/:id')
  getWordList(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user.userId;
    return this.learnService.getWordList(id, userId);
  }
}
