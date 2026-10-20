import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
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

    // Accept either 'type' (frontend) or 'movementType' (legacy)
    const resolvedType: MovementType =
      (dto.movementType ?? dto.type ?? MovementType.MANUAL_ADJUSTMENT) as MovementType;

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
          movementType: resolvedType,
          reason: dto.reason,
          userId,
        },
      });

      return { product: updatedProduct, movement };
    });
  }

  async getLowStockAlerts() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
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
    const limit = Number(query.limit) || 20;
    const page = Number(query.page) || 1;
    // Support legacy offset too
    const skip = query.offset !== undefined ? Number(query.offset) : (page - 1) * limit;
    const where: any = {};

    if (query.productId) where.productId = query.productId;
    if (query.movementType) where.movementType = query.movementType;

    const [total, data] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true, unitOfMeasurement: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return { data, total, page, limit, totalPages };
  }
}
