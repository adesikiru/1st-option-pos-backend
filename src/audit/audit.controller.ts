import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  async getLogs(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
  ) {
    return this.auditService.findAll({ limit, offset, action, resource });
  }
}
