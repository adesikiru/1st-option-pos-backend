import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StockAdjustmentDto, StockMovementsQueryDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Post('adjust')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  async adjustStock(@Body() dto: StockAdjustmentDto, @CurrentUser() user: any) {
    return this.inventoryService.adjustStock(dto, user.id);
  }

  @Get('low-stock')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER, Role.CASHIER)
  async getLowStockAlerts() {
    return this.inventoryService.getLowStockAlerts();
  }

  @Get('movements')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  async getMovements(@Query() query: StockMovementsQueryDto) {
    return this.inventoryService.getMovements(query);
  }
}
