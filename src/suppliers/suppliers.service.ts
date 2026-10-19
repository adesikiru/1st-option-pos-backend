import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, ReceiveStockDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  async findAll() {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true, stockReceipts: true } } },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: { select: { id: true, name: true, sku: true, stockQuantity: true } },
        stockReceipts: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { items: { include: { product: { select: { name: true, sku: true } } } } },
        },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    await this.findOne(id);
    return this.prisma.supplier.delete({ where: { id } });
  }

  async receiveStock(dto: ReceiveStockDto, userId: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one item must be received');
    }

    const receiptNumber = `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let totalCost = new Prisma.Decimal(0);

      const itemsData = dto.items.map((item) => {
        const qty = new Prisma.Decimal(item.quantity);
        const cost = new Prisma.Decimal(item.unitCost);
        const lineCost = qty.mul(cost);
        totalCost = totalCost.add(lineCost);
        return {
          productId: item.productId,
          quantity: qty,
          unitCost: cost,
          totalCost: lineCost,
        };
      });

      const receipt = await tx.stockReceipt.create({
        data: {
          receiptNumber,
          supplierId: dto.supplierId,
          userId,
          totalCost,
          notes: dto.notes,
          items: {
            create: itemsData,
          },
        },
        include: { items: true },
      });

      // Update product stock quantities and update costPrice if changed
      for (const item of dto.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new NotFoundException(`Product not found: ${item.productId}`);

        const currentQty = new Prisma.Decimal(product.stockQuantity);
        const addedQty = new Prisma.Decimal(item.quantity);
        const newQty = currentQty.add(addedQty);

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: newQty,
            costPrice: new Prisma.Decimal(item.unitCost), // update cost price with latest receiving cost
          },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            quantity: addedQty,
            previousQty: currentQty,
            newQty,
            movementType: MovementType.PURCHASE_RECEIPT,
            reference: receiptNumber,
            reason: `Stock receipt from supplier: ${dto.supplierId || 'Direct'}`,
            userId,
          },
        });
      }

      return receipt;
    });
  }

  async getReceipts() {
    return this.prisma.stockReceipt.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: true,
        user: { select: { id: true, name: true, email: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }
}
