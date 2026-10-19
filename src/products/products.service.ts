import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException(`SKU "${dto.sku}" already exists`);

    if (dto.barcode) {
      const barcodeExists = await this.prisma.product.findUnique({ where: { barcode: dto.barcode } });
      if (barcodeExists) throw new ConflictException(`Barcode "${dto.barcode}" already exists`);
    }

    return this.prisma.product.create({
      data: {
        ...dto,
        costPrice: new Prisma.Decimal(dto.costPrice),
        sellingPrice: new Prisma.Decimal(dto.sellingPrice),
        stockQuantity: dto.stockQuantity !== undefined ? new Prisma.Decimal(dto.stockQuantity) : undefined,
        minStockThreshold: dto.minStockThreshold !== undefined ? new Prisma.Decimal(dto.minStockThreshold) : undefined,
      },
      include: { category: true, supplier: true },
    });
  }

  async findAll(query: ProductQueryDto) {
    const { search, categoryId, lowStock, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(categoryId && { categoryId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(lowStock && {
        stockQuantity: { lte: this.prisma.product.fields.minStockThreshold as any },
      }),
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: true, supplier: { select: { id: true, name: true } } },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data: products, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findLowStock() {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        stockQuantity: { lte: this.prisma.product.fields.minStockThreshold as any },
      },
      include: { category: true },
      orderBy: { stockQuantity: 'asc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true, supplier: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async findBySku(sku: string) {
    const product = await this.prisma.product.findUnique({
      where: { sku },
      include: { category: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.costPrice !== undefined && { costPrice: new Prisma.Decimal(dto.costPrice) }),
        ...(dto.sellingPrice !== undefined && { sellingPrice: new Prisma.Decimal(dto.sellingPrice) }),
        ...(dto.minStockThreshold !== undefined && { minStockThreshold: new Prisma.Decimal(dto.minStockThreshold) }),
      },
      include: { category: true, supplier: true },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, name: true, isActive: true },
    });
  }
}
