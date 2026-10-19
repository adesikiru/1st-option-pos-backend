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

    const [todaySales, totalProducts, lowStockCount, recentSales, topProducts] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'COMPLETED' },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM products 
        WHERE is_active = true AND stock_quantity <= min_stock_threshold
      `,
      this.prisma.sale.findMany({
        where: { status: 'COMPLETED' },
        include: { cashier: { select: { name: true } }, _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.saleItem.groupBy({
        by: ['productId', 'productName'],
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { totalPrice: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      today: {
        totalSales: todaySales._sum.totalAmount ?? 0,
        transactionCount: todaySales._count.id,
      },
      totalProducts,
      lowStockCount: Number(lowStockCount[0]?.count ?? 0),
      recentSales,
      topProducts,
    };
  }

  async getSalesReport(dateFrom: string, dateTo: string) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const [summary, byPaymentMethod, byDay] = await Promise.all([
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
    ]);

    return { summary, byPaymentMethod, byDay };
  }

  async getInventoryReport() {
    const [products, movements] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true },
        include: { category: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.stockMovement.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        include: { product: { select: { name: true, sku: true } }, user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const totalValue = products.reduce((sum: number, p: any) => {
      return sum + Number(p.sellingPrice) * Number(p.stockQuantity);
    }, 0);

    const costValue = products.reduce((sum: number, p: any) => {
      return sum + Number(p.costPrice) * Number(p.stockQuantity);
    }, 0);

    return { products, totalValue, costValue, movements };
  }
}
