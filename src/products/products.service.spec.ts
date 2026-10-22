import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: {
    product: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      fields: any;
    };
  };

  const mockProduct = {
    id: 'prod-123',
    name: 'Bottled Water 75cl',
    sku: 'WAT-75',
    barcode: '001234567890',
    sellingPrice: new Prisma.Decimal('500.00'),
    costPrice: new Prisma.Decimal('350.00'),
    stockQuantity: new Prisma.Decimal('100'),
    minStockThreshold: new Prisma.Decimal('10'),
    isActive: true,
    category: { id: 'cat-1', name: 'Beverages' },
    supplier: { id: 'sup-1', name: 'Aqua Bottlers' },
  };

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        fields: { minStockThreshold: 'minStockThreshold' },
      },
    };
    service = new ProductsService(prisma as unknown as PrismaService);
  });

  describe('findByBarcode', () => {
    it('should return active product matching the barcode string with leading zeros', async () => {
      prisma.product.findFirst.mockResolvedValue(mockProduct);

      const result = await service.findByBarcode('001234567890');
      expect(result).toEqual(mockProduct);
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { barcode: '001234567890', isActive: true },
        include: { category: true, supplier: { select: { id: true, name: true } } },
      });
    });

    it('should trim barcode whitespace', async () => {
      prisma.product.findFirst.mockResolvedValue(mockProduct);

      const result = await service.findByBarcode('  001234567890  ');
      expect(result).toEqual(mockProduct);
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { barcode: '001234567890', isActive: true },
        include: { category: true, supplier: { select: { id: true, name: true } } },
      });
    });

    it('should throw BadRequestException if barcode is empty string', async () => {
      await expect(service.findByBarcode('')).rejects.toThrow(BadRequestException);
      await expect(service.findByBarcode('   ')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if barcode does not match any active product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findByBarcode('UNKNOWN-BARCODE-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySku', () => {
    it('should return product matching sku', async () => {
      prisma.product.findUnique.mockResolvedValue(mockProduct);

      const result = await service.findBySku('WAT-75');
      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException if sku does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findBySku('NON-EXISTENT')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should throw ConflictException if barcode already exists', async () => {
      prisma.product.findUnique
        .mockResolvedValueOnce(null) // SKU check passes
        .mockResolvedValueOnce(mockProduct); // Barcode exists

      await expect(
        service.create({
          name: 'New Water',
          sku: 'WAT-NEW',
          barcode: '001234567890',
          costPrice: 300,
          sellingPrice: 500,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
