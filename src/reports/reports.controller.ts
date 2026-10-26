import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // Dashboard is visible to all authenticated roles
  @Get('dashboard')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER, Role.CASHIER)
  getDashboard() {
    return this.reportsService.getDashboard();
  }

  @Get('inventory-summary')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER, Role.CASHIER)
  getInventorySummary() {
    return this.reportsService.getInventorySummary();
  }

  @Get('item-summary')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER, Role.CASHIER)
  getItemSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('categoryId') categoryId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.reportsService.getItemSummary(dateFrom, dateTo, categoryId, supplierId);
  }

  @Get('sales')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER, Role.CASHIER)
  getSalesReport(@Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    return this.reportsService.getSalesReport(dateFrom, dateTo);
  }

  @Get('inventory')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER, Role.CASHIER)
  getInventoryReport() {
    return this.reportsService.getInventoryReport();
  }
}
