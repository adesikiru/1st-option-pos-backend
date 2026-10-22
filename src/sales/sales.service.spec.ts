import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

describe('SalesService', () => {
  let service: SalesService;
  let prisma: {
    sale: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    product: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    stockMovement: {
      create: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  const mockProductA = {
    id: 'prod-A',
    name: 'Bottled Water 75cl',
    sku: 'WAT-75',
    barcode: '001234567890',
    costPrice: new Prisma.Decimal('300.00'),
    sellingPrice: new Prisma.Decimal('500.00'),
    stockQuantity: new Prisma.Decimal('10.00'),
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      sale: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      product: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      stockMovement: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(prisma);
      }),
    };
    service = new SalesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('should return existing sale if idempotencyKey already exists', async () => {
      const existingSale = { id: 'sale-existing', receiptNumber: 'RCP-2026-123' };
      prisma.sale.findUnique.mockResolvedValue(existingSale);

      const result = await service.create(
        {
          items: [{ productId: 'prod-A', quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          idempotencyKey: 'idemp-123',
        },
        'cashier-1',
      );

      expect(result).toBe(existingSale);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if items array is empty', async () => {
      await expect(
        service.create(
          {
            items: [],
            paymentMethod: PaymentMethod.CASH,
          },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if product is not found or inactive', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);
      prisma.product.findMany.mockResolvedValue([]); // Not found

      await expect(
        service.create(
          {
            items: [{ productId: 'prod-unknown', quantity: 1 }],
            paymentMethod: PaymentMethod.CASH,
          },
          'cashier-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if requested quantity exceeds stock', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);
      prisma.product.findMany.mockResolvedValue([mockProductA]); // Available: 10

      await expect(
        service.create(
          {
            items: [{ productId: 'prod-A', quantity: 15 }], // 15 > 10
            paymentMethod: PaymentMethod.CASH,
          },
          'cashier-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate authoritative totals from DB prices and deduct inventory in transaction', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);
      prisma.product.findMany.mockResolvedValue([mockProductA]);

      const mockSavedSale = {
        id: 'sale-new-1',
        receiptNumber: 'RCP-2026-0001',
        totalAmount: new Prisma.Decimal('1500.00'),
      };
      prisma.sale.create.mockResolvedValue(mockSavedSale);

      const result = await service.create(
        {
          items: [{ productId: 'prod-A', quantity: 3, discount: 0 }],
          paymentMethod: PaymentMethod.CASH,
        },
        'cashier-1',
      );

      expect(result).toBe(mockSavedSale);
      expect(prisma.sale.create).toHaveBeenCalled();
      const createArgs = prisma.sale.create.mock.calls[0][0];
      // Total amount should be 3 * 500 = 1500
      expect(createArgs.data.totalAmount.toString()).toBe('1500');
      // Product stock should be updated to 10 - 3 = 7
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-A' },
        data: { stockQuantity: new Prisma.Decimal(7) },
      });
      // Stock movement created
      expect(prisma.stockMovement.create).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return sale details with items and cashier for receipt reprinting', async () => {
      const mockSale = {
        id: 'sale-1',
        receiptNumber: 'RCP-2026-0001',
        cashier: { id: 'u1', name: 'Cashier Alice' },
        items: [
          {
            id: 'item-1',
            productName: 'Bottled Water 75cl',
            quantity: new Prisma.Decimal(2),
            unitPrice: new Prisma.Decimal(500),
            totalPrice: new Prisma.Decimal(1000),
          },
        ],
        payments: [{ paymentMethod: PaymentMethod.CASH, amount: new Prisma.Decimal(1000) }],
      };
      prisma.sale.findUnique.mockResolvedValue(mockSale);

      const result = await service.findOne('sale-1');
      expect(result).toEqual(mockSale);
    });

    it('should throw NotFoundException if sale does not exist', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});
