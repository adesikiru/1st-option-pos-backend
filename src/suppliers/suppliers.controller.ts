import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateSupplierDto, ReceiveStockDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  findAll() {
    return this.suppliersService.findAll();
  }

  @Get('receipts')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  getReceipts() {
    return this.suppliersService.getReceipts();
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  delete(@Param('id') id: string) {
    return this.suppliersService.delete(id);
  }

  @Post('receive')
  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  receiveStock(@Body() dto: ReceiveStockDto, @CurrentUser() user: any) {
    return this.suppliersService.receiveStock(dto, user.id);
  }
}
