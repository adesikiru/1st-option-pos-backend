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
      include: { category: true },
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
}
