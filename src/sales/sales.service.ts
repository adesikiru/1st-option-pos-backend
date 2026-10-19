import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MovementType, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto, SaleQueryDto, VoidSaleDto } from './dto/sale.dto';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  private generateReceiptNumber(): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timePart = Date.now().toString().slice(-6);
    return `RCP-${datePart}-${timePart}`;
  }

  async create(dto: CreateSaleDto, cashierId: string) {
    // Idempotency check
    if (dto.idempotencyKey) {
      const existing = await this.prisma.sale.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) return existing;
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sale must have at least one item');
    }

    // Fetch all products at once
    const productIds = dto.items.map((i: any) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });

    if (products.length !== productIds.length) {
      throw new NotFoundException('One or more products not found or inactive');
    }

    // Validate stock
    for (const item of dto.items) {
      const product = products.find((p: any) => p.id === item.productId)!;
      if (new Prisma.Decimal(product.stockQuantity).lt(new Prisma.Decimal(item.quantity))) {
        throw new BadRequestException(`Insufficient stock for "${product.name}". Available: ${product.stockQuantity}`);
      }
    }

    // Build sale items and totals
    const saleItemsData = dto.items.map((item: any) => {
      const product = products.find((p: any) => p.id === item.productId)!;
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(product.sellingPrice);
      const unitCost = new Prisma.Decimal(product.costPrice);
      const discount = new Prisma.Decimal(item.discount ?? 0);
      const totalPrice = unitPrice.mul(quantity).sub(discount);
      return { productId: item.productId, productName: product.name, sku: product.sku, quantity, unitCost, unitPrice, discount, totalPrice };
    });

    const subtotal = saleItemsData.reduce((sum: Prisma.Decimal, i: any) => sum.add(i.totalPrice), new Prisma.Decimal(0));
    const totalAmount = subtotal;
    const discountTotal = saleItemsData.reduce((sum: Prisma.Decimal, i: any) => sum.add(i.discount), new Prisma.Decimal(0));

    const receiptNumber = this.generateReceiptNumber();

    const sale = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newSale = await tx.sale.create({
        data: {
          receiptNumber,
          cashierId,
          subtotal,
          discountTotal,
          taxTotal: new Prisma.Decimal(0),
          totalAmount,
          paymentMethod: dto.paymentMethod,
          idempotencyKey: dto.idempotencyKey,
          notes: dto.notes,
          items: {
            create: saleItemsData,
          },
          payments: {
            create: {
              paymentMethod: dto.paymentMethod,
              amount: totalAmount,
            },
          },
        },
        include: { items: true, payments: true, cashier: { select: { id: true, name: true } } },
      });

      // Deduct stock and record movements
      for (const item of dto.items) {
        const product = products.find((p: any) => p.id === item.productId)!;
        const newQty = new Prisma.Decimal(product.stockQuantity).sub(new Prisma.Decimal(item.quantity));
        await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: newQty } });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            quantity: new Prisma.Decimal(item.quantity).neg(),
            previousQty: new Prisma.Decimal(product.stockQuantity),
            newQty,
            movementType: MovementType.SALE,
            reference: receiptNumber,
            userId: cashierId,
          },
        });
      }

      return newSale;
    });

    return sale;
  }

  async findAll(query: SaleQueryDto) {
    const { dateFrom, dateTo, cashierId, receiptNumber, paymentMethod, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SaleWhereInput = {
      ...(cashierId && { cashierId }),
      ...(receiptNumber && { receiptNumber: { contains: receiptNumber, mode: 'insensitive' } }),
      ...(paymentMethod && { paymentMethod }),
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          cashier: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { data: sales, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        cashier: { select: { id: true, name: true } },
        payments: true,
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  async voidSale(id: string, dto: VoidSaleDto, userId: string) {
    const sale = await this.findOne(id);
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new BadRequestException('Only completed sales can be voided');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.VOIDED, notes: dto.reason },
      });

      // Restore stock
      for (const item of sale.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) continue;
        const newQty = new Prisma.Decimal(product.stockQuantity).add(new Prisma.Decimal(item.quantity));
        await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: newQty } });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            quantity: new Prisma.Decimal(item.quantity),
            previousQty: new Prisma.Decimal(product.stockQuantity),
            newQty,
            movementType: MovementType.RETURN_REFUND,
            reference: sale.receiptNumber,
            reason: dto.reason,
            userId,
          },
        });
      }

      return updated;
    });
  }
}
