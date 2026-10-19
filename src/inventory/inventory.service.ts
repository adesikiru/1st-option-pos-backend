import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockAdjustmentDto, StockMovementsQueryDto } from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async adjustStock(dto: StockAdjustmentDto, userId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const currentQty = new Prisma.Decimal(product.stockQuantity);
    const adjustmentQty = new Prisma.Decimal(dto.quantity);
    const newQty = currentQty.add(adjustmentQty);

    if (newQty.lt(0)) {
      throw new BadRequestException(`Cannot adjust stock below 0. Current stock: ${currentQty}`);
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedProduct = await tx.product.update({
        where: { id: dto.productId },
        data: { stockQuantity: newQty },
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: dto.productId,
          quantity: adjustmentQty,
          previousQty: currentQty,
          newQty,
          movementType: dto.movementType,
          reason: dto.reason,
          userId,
        },
      });

      return { product: updatedProduct, movement };
    });
  }

  async getLowStockAlerts() {
    // Find products where stockQuantity <= minStockThreshold
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
      },
      include: {
        category: true,
        supplier: true,
      },
      orderBy: { stockQuantity: 'asc' },
    });

    return products.filter((p: any) =>
      new Prisma.Decimal(p.stockQuantity).lte(new Prisma.Decimal(p.minStockThreshold)),
    );
  }

  async getMovements(query: StockMovementsQueryDto) {
    const take = Number(query.limit) || 50;
    const skip = Number(query.offset) || 0;
    const where: any = {};

    if (query.productId) where.productId = query.productId;
    if (query.movementType) where.movementType = query.movementType;

    const [total, movements] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true, unitOfMeasurement: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return { total, movements, take, skip };
  }
}
