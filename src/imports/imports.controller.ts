import { Body, Controller, Get, Header, Post, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ImportsService } from './imports.service';

@Controller('imports')
export class ImportsController {
  constructor(private importsService: ImportsService) {}

  @Get('template')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="product_import_template.csv"')
  getTemplate(): string {
    return this.importsService.getSampleCsvTemplate();
  }

  @Post('products-csv')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  async importCsv(
    @Body('csvContent') csvContent: string,
    @Body('fileName') fileName: string,
    @CurrentUser() user: any,
  ) {
    return this.importsService.processProductImport(csvContent, fileName || 'products.csv', user.id);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  async getHistory() {
    return this.importsService.getImportHistory();
  }
}
