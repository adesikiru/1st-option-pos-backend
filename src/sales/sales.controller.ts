import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateSaleDto, SaleQueryDto, VoidSaleDto } from './dto/sale.dto';
import { SalesService } from './sales.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Roles(Role.ADMIN, Role.MANAGER, Role.CASHIER)
  @Post()
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: any) {
    return this.salesService.create(dto, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.CASHIER)
  @Get()
  findAll(@Query() query: SaleQueryDto) {
    return this.salesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/void')
  voidSale(@Param('id') id: string, @Body() dto: VoidSaleDto, @CurrentUser() user: any) {
    return this.salesService.voidSale(id, dto, user.id);
  }
}
