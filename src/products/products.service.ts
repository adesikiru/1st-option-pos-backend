import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

  async findByBarcode(barcode: string) {
    if (!barcode || !barcode.trim()) {
      throw new BadRequestException('Barcode must not be empty');
    }
    const product = await this.prisma.product.findFirst({
      where: {
        barcode: barcode.trim(),
        isActive: true,
      },
      include: { category: true, supplier: { select: { id: true, name: true } } },
    });
    if (!product) {
      throw new NotFoundException(`Product with barcode "${barcode.trim()}" not found or is inactive`);
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto, userId?: string) {
    const existing = await this.findOne(id);
    const hasQtyChange = dto.stockQuantity !== undefined && Number(dto.stockQuantity) !== Number(existing.stockQuantity);

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.costPrice !== undefined && { costPrice: new Prisma.Decimal(dto.costPrice) }),
        ...(dto.sellingPrice !== undefined && { sellingPrice: new Prisma.Decimal(dto.sellingPrice) }),
        ...(dto.minStockThreshold !== undefined && { minStockThreshold: new Prisma.Decimal(dto.minStockThreshold) }),
        ...(dto.stockQuantity !== undefined && { stockQuantity: new Prisma.Decimal(dto.stockQuantity) }),
      },
      include: { category: true, supplier: true },
    });

    if (hasQtyChange && userId) {
      const prev = new Prisma.Decimal(existing.stockQuantity);
      const next = new Prisma.Decimal(dto.stockQuantity!);
      const diff = next.sub(prev);

      await this.prisma.stockMovement.create({
        data: {
          productId: id,
          quantity: diff,
          previousQty: prev,
          newQty: next,
          movementType: 'MANUAL_ADJUSTMENT',
          reason: 'Item on-hand quantity updated directly (QuickBooks edit)',
          userId,
        },
      });
    }

    return updated;
  }

  async getProductStatistics(id: string) {
    const product = await this.findOne(id);

    // Get all sale items for this product from completed sales
    const saleItems = await this.prisma.saleItem.findMany({
      where: {
        productId: id,
        sale: { status: 'COMPLETED' },
      },
      include: {
        sale: { select: { receiptNumber: true, createdAt: true } },
      },
    });

    let netSales = 0;
    let costOfGoods = 0;
    let totalQtySold = 0;

    for (const item of saleItems) {
      const qty = Number(item.quantity);
      const itemTotal = Number(item.totalPrice);
      const itemCost = Number(item.unitCost) * qty;

      netSales += itemTotal;
      costOfGoods += itemCost;
      totalQtySold += qty;
    }

    const profit = netSales - costOfGoods;
    const profitMargin = netSales > 0 ? (profit / netSales) * 100 : 0;

    // Get all stock movements for this product
    const movements = await this.prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });

    // Quantity IN breakdown:
    // - Received (PURCHASE_RECEIPT)
    // - Sales Returns (RETURN_REFUND where qty > 0)
    // - Adjustments (MANUAL_ADJUSTMENT or INITIAL_STOCK where qty > 0)
    // - Transfers (Transfers in)
    let qtyReceived = 0;
    let qtySalesReturns = 0;
    let qtyAdjustmentsIn = 0;
    let qtyTransfersIn = 0;

    // Quantity OUT breakdown:
    // - Sold (SALE or completed sales)
    // - Vendor Returns (RETURN_REFUND where qty < 0)
    // - Adjustments (DAMAGE_EXPIRED or MANUAL_ADJUSTMENT where qty < 0)
    // - Transfers (Transfers out)
    let qtySold = totalQtySold;
    let qtyVendorReturns = 0;
    let qtyAdjustmentsOut = 0;
    let qtyTransfersOut = 0;

    for (const m of movements) {
      const qty = Number(m.quantity);
      const type = m.movementType;

      if (type === 'PURCHASE_RECEIPT') {
        qtyReceived += Math.abs(qty);
      } else if (type === 'RETURN_REFUND') {
        if (qty > 0) qtySalesReturns += qty;
        else qtyVendorReturns += Math.abs(qty);
      } else if (type === 'INITIAL_STOCK') {
        qtyAdjustmentsIn += Math.abs(qty);
      } else if (type === 'DAMAGE_EXPIRED') {
        qtyAdjustmentsOut += Math.abs(qty);
      } else if (type === 'MANUAL_ADJUSTMENT') {
        if (qty >= 0) qtyAdjustmentsIn += qty;
        else qtyAdjustmentsOut += Math.abs(qty);
      }
    }

    const totalQtyIn = qtyReceived + qtySalesReturns + qtyAdjustmentsIn + qtyTransfersIn;
    const totalQtyOut = qtySold + qtyVendorReturns + qtyAdjustmentsOut + qtyTransfersOut;

    const onHandQty = Number(product.stockQuantity);
    const unitCost = Number(product.costPrice);
    const unitPrice = Number(product.sellingPrice);
    const extCost = onHandQty * unitCost;
    const extPrice = onHandQty * unitPrice;

    return {
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        description: product.description,
        department: product.category?.name || 'General',
        categoryId: product.categoryId,
        vendor: product.supplier?.name || 'None',
        supplierId: product.supplierId,
        unitOfMeasurement: product.unitOfMeasurement,
        onHandQty,
        unitCost,
        unitPrice,
        extCost,
        extPrice,
        minStockThreshold: Number(product.minStockThreshold),
        isActive: product.isActive,
      },
      totals: {
        netSales,
        costOfGoods,
        profit,
        profitMargin: Number(profitMargin.toFixed(2)),
        totalQtySold,
      },
      quantityIn: {
        received: qtyReceived,
        salesReturns: qtySalesReturns,
        adjustments: qtyAdjustmentsIn,
        transfers: qtyTransfersIn,
        total: totalQtyIn,
      },
      quantityOut: {
        sold: qtySold,
        vendorReturns: qtyVendorReturns,
        adjustments: qtyAdjustmentsOut,
        transfers: qtyTransfersOut,
        total: totalQtyOut,
      },
      history: movements.map((m) => ({
        id: m.id,
        changeDate: m.createdAt,
        type: m.movementType,
        quantity: Number(m.quantity),
        previousQty: Number(m.previousQty),
        onHandQuantity: Number(m.newQty),
        reason: m.reason || (m.movementType === 'SALE' ? 'Customer Purchase' : 'Stock adjustment'),
        reference: m.reference,
        changedBy: m.user?.name || 'System',
      })),
    };
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
