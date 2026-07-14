import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService, type AiKeyView, type AiProviderView } from './ai.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createKeySchema,
  reorderKeySchema,
  setKeyStatusSchema,
  setProviderEnabledSchema,
  type CreateKeyDto,
  type ReorderKeyDto,
  type SetKeyStatusDto,
  type SetProviderEnabledDto,
} from './dto/ai.dto';

@ApiTags('ai')
@Roles('OWNER', 'ADMIN') // docs/08 §1: view/edit AI keys & providers is Owner/Admin only
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('providers')
  listProviders(): Promise<AiProviderView[]> {
    return this.ai.listProviders();
  }

  @Patch('providers/:id')
  @Audit('ai_provider.set_enabled', 'AiProvider')
  setProviderEnabled(
    @Param('id') id: string,
    @Body(new ZodBody(setProviderEnabledSchema)) body: SetProviderEnabledDto,
  ): Promise<AiProviderView> {
    return this.ai.setProviderEnabled(id, body.enabled);
  }

  @Post('providers/:id/keys')
  @Audit('ai_key.create', 'AiKey')
  createKey(
    @Param('id') providerId: string,
    @Body(new ZodBody(createKeySchema)) body: CreateKeyDto,
  ): Promise<AiKeyView> {
    return this.ai.createKey(providerId, body);
  }

  @Patch('keys/:id/status')
  @Audit('ai_key.set_status', 'AiKey')
  setKeyStatus(
    @Param('id') id: string,
    @Body(new ZodBody(setKeyStatusSchema)) body: SetKeyStatusDto,
  ): Promise<AiKeyView> {
    return this.ai.setKeyStatus(id, body.status);
  }

  @Patch('keys/:id/reorder')
  @Audit('ai_key.reorder', 'AiKey')
  reorderKey(
    @Param('id') id: string,
    @Body(new ZodBody(reorderKeySchema)) body: ReorderKeyDto,
  ): Promise<AiKeyView[]> {
    return this.ai.reorderKey(id, body.direction);
  }

  @Delete('keys/:id')
  @Audit('ai_key.delete', 'AiKey')
  deleteKey(@Param('id') id: string): Promise<{ id: string }> {
    return this.ai.deleteKey(id);
  }
}
