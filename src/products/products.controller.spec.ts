import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findLowStock: ReturnType<typeof vi.fn>;
    findBySku: ReturnType<typeof vi.fn>;
    findByBarcode: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findAll: vi.fn(),
      findLowStock: vi.fn(),
      findBySku: vi.fn(),
      findByBarcode: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      deactivate: vi.fn(),
    };
    controller = new ProductsController(service as unknown as ProductsService);
  });

  it('should delegate findByBarcode to service.findByBarcode', async () => {
    const mockProduct = { id: 'p1', name: 'Product 1', barcode: '123456789' };
    service.findByBarcode.mockResolvedValue(mockProduct);

    const result = await controller.findByBarcode('123456789');
    expect(service.findByBarcode).toHaveBeenCalledWith('123456789');
    expect(result).toEqual(mockProduct);
  });
});
