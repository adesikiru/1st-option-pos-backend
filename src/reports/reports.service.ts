import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      todaySales,
      totalProducts,
      allActiveProducts,
      recentSales,
      topProductsRaw,
      todayByPaymentMethod,
    ] = await Promise.all([
      // Today's sales aggregate
      this.prisma.sale.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'COMPLETED' },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Count active products
      this.prisma.product.count({ where: { isActive: true } }),
      // All active products (for inventory valuation + low stock count)
      this.prisma.product.findMany({
        where: { isActive: true },
        select: {
          stockQuantity: true,
          minStockThreshold: true,
          costPrice: true,
          sellingPrice: true,
        },
      }),
      // Recent 10 completed sales
      this.prisma.sale.findMany({
        where: { status: 'COMPLETED' },
        include: { cashier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Top selling products all time by revenue
      this.prisma.saleItem.groupBy({
        by: ['productId', 'productName', 'sku'],
        where: {
          sale: { status: 'COMPLETED' },
        },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { totalPrice: 'desc' } },
        take: 10,
      }),
      // Today's sales grouped by payment method
      this.prisma.sale.groupBy({
        by: ['paymentMethod'],
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'COMPLETED' },
        _sum: { totalAmount: true },
      }),
    ]);

    // Compute inventory valuation
    let totalStockCost = 0;
    let totalStockRetailValue = 0;
    let totalItems = 0;
    let lowStockCount = 0;

    for (const p of allActiveProducts) {
      const qty = Number(p.stockQuantity);
      const cost = Number(p.costPrice);
      const retail = Number(p.sellingPrice);
      const threshold = Number(p.minStockThreshold);

      totalItems += qty;
      totalStockCost += qty * cost;
      totalStockRetailValue += qty * retail;

      if (qty <= threshold) {
        lowStockCount++;
      }
    }

    // Build salesByPaymentMethod map
    const salesByPaymentMethod: Record<string, number> = {};
    for (const row of todayByPaymentMethod) {
      salesByPaymentMethod[row.paymentMethod] = Number(row._sum.totalAmount ?? 0);
    }

    // Format top products
    const topProducts = topProductsRaw.map((p) => ({
      productId: p.productId,
      name: p.productName,
      sku: p.sku,
      quantitySold: Number(p._sum.quantity ?? 0),
      revenue: Number(p._sum.totalPrice ?? 0),
    }));

    return {
      todaySales: Number(todaySales._sum.totalAmount ?? 0),
      todayTransactions: todaySales._count.id,
      totalInStock: totalProducts,
      lowStockCount,
      inventoryValuation: {
        totalItems,
        totalStockCost,
        totalStockRetailValue,
      },
      salesByPaymentMethod,
      recentSales,
      topProducts,
    };
  }

  async getSalesReport(dateFrom: string, dateTo: string) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const [summary, byPaymentMethodRaw, dailySalesRaw, topProductsRaw] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { createdAt: { gte: from, lte: to }, status: 'COMPLETED' },
        _sum: { totalAmount: true, discountTotal: true },
        _count: { id: true },
      }),
      this.prisma.sale.groupBy({
        by: ['paymentMethod'],
        where: { createdAt: { gte: from, lte: to }, status: 'COMPLETED' },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.$queryRaw<any[]>`
        SELECT DATE(created_at) as date,
               SUM(total_amount) as total,
               COUNT(*) as count
        FROM sales
        WHERE created_at >= ${from} AND created_at <= ${to} AND status = 'COMPLETED'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
      this.prisma.saleItem.groupBy({
        by: ['productId', 'productName', 'sku'],
        where: { sale: { status: 'COMPLETED', createdAt: { gte: from, lte: to } } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { totalPrice: 'desc' } },
        take: 10,
      }),
    ]);

    const totalRevenue = Number(summary._sum.totalAmount ?? 0);
    const totalTransactions = summary._count.id;
    const totalDiscounts = Number(summary._sum.discountTotal ?? 0);
    const averageSaleValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Build byPaymentMethod map {METHOD: {amount, count}}
    const byPaymentMethod: Record<string, { amount: number; count: number }> = {};
    for (const row of byPaymentMethodRaw) {
      byPaymentMethod[row.paymentMethod] = {
        amount: Number(row._sum.totalAmount ?? 0),
        count: row._count.id,
      };
    }

    const dailySales = dailySalesRaw.map((row: any) => ({
      date: row.date,
      total: Number(row.total),
      count: Number(row.count),
    }));

    const topProducts = topProductsRaw.map((p) => ({
      productId: p.productId,
      name: p.productName,
      sku: p.sku,
      quantitySold: Number(p._sum.quantity ?? 0),
      revenue: Number(p._sum.totalPrice ?? 0),
    }));

    return {
      totalRevenue,
      totalTransactions,
      averageSaleValue,
      totalDiscounts,
      byPaymentMethod,
      topProducts,
      dailySales,
    };
  }

  async getInventoryReport() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { category: true, supplier: true },
      orderBy: { name: 'asc' },
    });

    const totalRetailValue = products.reduce((sum: number, p: any) => {
      return sum + Number(p.sellingPrice) * Number(p.stockQuantity);
    }, 0);

    const totalCostValue = products.reduce((sum: number, p: any) => {
      return sum + Number(p.costPrice) * Number(p.stockQuantity);
    }, 0);

    const lowStockCount = products.filter(
      (p: any) => Number(p.stockQuantity) <= Number(p.minStockThreshold),
    ).length;

    return {
      summary: {
        activeProducts: products.length,
        lowStockCount,
        totalRetailValue,
        totalCostValue,
      },
      products,
    };
  }

  async getInventorySummary() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: {
        category: true,
        supplier: true,
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });

    // Department grouping
    const deptMap = new Map<string, {
      department: string;
      onHandQty: number;
      extCost: number;
      extPrice: number;
      onOrder: number;
      products: Array<{
        id: string;
        name: string;
        sku: string;
        barcode: string | null;
        department: string;
        vendor: string;
        onHandQty: number;
        costPrice: number;
        sellingPrice: number;
        extCost: number;
        extPrice: number;
        onOrder: number;
        minStockThreshold: number;
        unitOfMeasurement: string;
      }>;
    }>();

    for (const p of products) {
      const deptName = p.category?.name || 'General';
      const onHand = Number(p.stockQuantity);
      const cost = Number(p.costPrice);
      const price = Number(p.sellingPrice);
      const extCost = onHand * cost;
      const extPrice = onHand * price;
      const onOrder = 0; // Default on order quantity

      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, {
          department: deptName,
          onHandQty: 0,
          extCost: 0,
          extPrice: 0,
          onOrder: 0,
          products: [],
        });
      }

      const d = deptMap.get(deptName)!;
      d.onHandQty += onHand;
      d.extCost += extCost;
      d.extPrice += extPrice;
      d.onOrder += onOrder;
      d.products.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        department: deptName,
        vendor: p.supplier?.name || 'None',
        onHandQty: onHand,
        costPrice: cost,
        sellingPrice: price,
        extCost,
        extPrice,
        onOrder,
        minStockThreshold: Number(p.minStockThreshold),
        unitOfMeasurement: p.unitOfMeasurement,
      });
    }

    const departments = Array.from(deptMap.values()).map((d) => {
      const margin = d.extPrice - d.extCost;
      const marginPercent = d.extPrice > 0 ? Number(((margin / d.extPrice) * 100).toFixed(2)) : 0;
      return {
        ...d,
        margin,
        marginPercent,
      };
    });

    const totalOnHandQty = departments.reduce((acc, d) => acc + d.onHandQty, 0);
    const totalExtCost = departments.reduce((acc, d) => acc + d.extCost, 0);
    const totalExtPrice = departments.reduce((acc, d) => acc + d.extPrice, 0);
    const totalOnOrder = departments.reduce((acc, d) => acc + d.onOrder, 0);
    const totalMargin = totalExtPrice - totalExtCost;
    const overallMarginPercent = totalExtPrice > 0 ? Number(((totalMargin / totalExtPrice) * 100).toFixed(2)) : 0;

    return {
      departments,
      totals: {
        totalProducts: products.length,
        totalOnHandQty,
        totalExtCost,
        totalExtPrice,
        totalOnOrder,
        totalMargin,
        overallMarginPercent,
      },
    };
  }

  async getItemSummary(dateFrom?: string, dateTo?: string, categoryId?: string, supplierId?: string) {
    const today = new Date();
    const from = dateFrom ? new Date(dateFrom) : new Date(today.getFullYear(), today.getMonth(), 1);
    const to = dateTo ? new Date(dateTo) : new Date();
    to.setHours(23, 59, 59, 999);

    const saleItems = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          status: 'COMPLETED',
          createdAt: { gte: from, lte: to },
        },
        product: {
          ...(categoryId ? { categoryId } : {}),
          ...(supplierId ? { supplierId } : {}),
        },
      },
      include: {
        product: {
          include: {
            category: true,
            supplier: true,
          },
        },
      },
    });

    // Aggregate by productId
    const map = new Map<string, {
      productId: string;
      productName: string;
      sku: string;
      department: string;
      vendor: string;
      qtySold: number;
      extPrice: number;
      extCost: number;
    }>();

    for (const item of saleItems) {
      const pid = item.productId;
      const qty = Number(item.quantity);
      const extPrice = Number(item.totalPrice);
      const extCost = Number(item.unitCost) * qty;
      const dept = item.product?.category?.name || 'General';
      const vendor = item.product?.supplier?.name || 'None';

      if (!map.has(pid)) {
        map.set(pid, {
          productId: pid,
          productName: item.productName || item.product?.name || 'Unknown',
          sku: item.sku || item.product?.sku || '',
          department: dept,
          vendor: vendor,
          qtySold: 0,
          extPrice: 0,
          extCost: 0,
        });
      }

      const row = map.get(pid)!;
      row.qtySold += qty;
      row.extPrice += extPrice;
      row.extCost += extCost;
    }

    const items = Array.from(map.values()).map((row) => {
      const margin = row.extPrice - row.extCost;
      const marginPercent = row.extPrice > 0 ? (margin / row.extPrice) * 100 : 0;
      return {
        ...row,
        margin,
        marginPercent: Number(marginPercent.toFixed(2)),
      };
    });

    // Sort by extPrice desc
    items.sort((a, b) => b.extPrice - a.extPrice);

    // Compute totals
    const totalQtySold = items.reduce((acc, i) => acc + i.qtySold, 0);
    const totalExtPrice = items.reduce((acc, i) => acc + i.extPrice, 0);
    const totalExtCost = items.reduce((acc, i) => acc + i.extCost, 0);
    const totalMargin = totalExtPrice - totalExtCost;
    const overallMarginPercent = totalExtPrice > 0 ? Number(((totalMargin / totalExtPrice) * 100).toFixed(2)) : 0;

    return {
      dateFrom: from.toISOString().split('T')[0],
      dateTo: to.toISOString().split('T')[0],
      items,
      totals: {
        totalQtySold,
        totalExtPrice,
        totalExtCost,
        totalMargin,
        overallMarginPercent,
      },
    };
  }
}
