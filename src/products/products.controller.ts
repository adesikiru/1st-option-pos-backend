import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get('low-stock')
  findLowStock() {
    return this.productsService.findLowStock();
  }

  @Get('sku/:sku')
  findBySku(@Param('sku') sku: string) {
    return this.productsService.findBySku(sku);
  }

  @Get('barcode/:barcode')
  findByBarcode(@Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(barcode);
  }

  @Get(':id/statistics')
  getStatistics(@Param('id') id: string) {
    return this.productsService.getProductStatistics(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.INVENTORY_OFFICER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: any) {
    return this.productsService.update(id, dto, user?.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.productsService.deactivate(id);
  }
}
