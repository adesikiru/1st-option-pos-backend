import { BadRequestException, Injectable } from '@nestjs/common';
import { ImportStatus, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CsvProductRow {
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  category?: string;
  unitOfMeasurement?: string;
  costPrice: number;
  sellingPrice: number;
  stockQuantity: number;
  minStockThreshold?: number;
}

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService) {}

  getSampleCsvTemplate(): string {
    const headers = 'name,sku,barcode,description,category,unitOfMeasurement,costPrice,sellingPrice,stockQuantity,minStockThreshold\n';
    const sampleRow1 = 'Coca Cola 500ml,COKE-500,5449000000996,Chilled soda bottle,Beverages,bottle,250.00,350.00,48,12\n';
    const sampleRow2 = 'Digestive Biscuits 200g,DIG-200,8901030000123,Whole wheat biscuits,Snacks & Confectionery,pack,400.00,550.00,24,6\n';
    const sampleRow3 = 'Hand Sanitizer 100ml,SAN-100,6001000000456,70% Alcohol gel,Personal Care,bottle,500.00,750.00,30,5\n';
    return headers + sampleRow1 + sampleRow2 + sampleRow3;
  }

  parseCsv(content: string): { rows: any[]; errors: string[] } {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must have a header row and at least one data row');
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const expectedHeaders = ['name', 'sku', 'costprice', 'sellingprice', 'stockquantity'];
    for (const exp of expectedHeaders) {
      if (!headers.includes(exp)) {
        throw new BadRequestException(`CSV missing required column: ${exp}`);
      }
    }

    const rows: any[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // simple comma split taking care of trimmed items
      const cols = line.split(',').map((c) => c.trim());
      const rowData: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rowData[h] = cols[idx] !== undefined ? cols[idx] : '';
      });

      // Basic row validation
      const name = rowData['name'];
      const sku = rowData['sku'];
      const costPrice = parseFloat(rowData['costprice']);
      const sellingPrice = parseFloat(rowData['sellingprice']);
      const stockQuantity = parseFloat(rowData['stockquantity'] || '0');

      if (!name || !sku) {
        errors.push(`Row ${i + 1}: Name and SKU are required`);
        continue;
      }

      if (isNaN(costPrice) || costPrice < 0) {
        errors.push(`Row ${i + 1} (${sku}): Invalid costPrice "${rowData['costprice']}"`);
        continue;
      }

      if (isNaN(sellingPrice) || sellingPrice < 0) {
        errors.push(`Row ${i + 1} (${sku}): Invalid sellingPrice "${rowData['sellingprice']}"`);
        continue;
      }

      rows.push({
        name,
        sku,
        barcode: rowData['barcode'] || undefined,
        description: rowData['description'] || undefined,
        category: rowData['category'] || undefined,
        unitOfMeasurement: rowData['unitofmeasurement'] || 'pcs',
        costPrice,
        sellingPrice,
        stockQuantity: isNaN(stockQuantity) ? 0 : stockQuantity,
        minStockThreshold: parseFloat(rowData['minstockthreshold'] || '5') || 5,
        rowNumber: i + 1,
      });
    }

    return { rows, errors };
  }

  async processProductImport(csvContent: string, fileName: string, userId: string) {
    const { rows, errors } = this.parseCsv(csvContent);

    let importedCount = 0;
    const rowErrors: string[] = [...errors];

    // Create import job record
    const job = await this.prisma.importJob.create({
      data: {
        fileName,
        totalRows: rows.length + errors.length,
        importedRows: 0,
        failedRows: errors.length,
        status: ImportStatus.PENDING,
        userId,
      },
    });

    for (const row of rows) {
      try {
        await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Check for duplicate SKU
          const existingSku = await tx.product.findUnique({ where: { sku: row.sku } });
          if (existingSku) {
            throw new Error(`Product with SKU "${row.sku}" already exists`);
          }

          // Check for duplicate barcode if provided
          if (row.barcode) {
            const existingBarcode = await tx.product.findUnique({ where: { barcode: row.barcode } });
            if (existingBarcode) {
              throw new Error(`Product with barcode "${row.barcode}" already exists`);
            }
          }

          // Find or create category
          let categoryId: string | undefined = undefined;
          if (row.category) {
            let cat = await tx.category.findUnique({ where: { name: row.category } });
            if (!cat) {
              cat = await tx.category.create({ data: { name: row.category } });
            }
            categoryId = cat.id;
          }

          // Create product
          const product = await tx.product.create({
            data: {
              name: row.name,
              sku: row.sku,
              barcode: row.barcode,
              description: row.description,
              categoryId,
              unitOfMeasurement: row.unitOfMeasurement,
              costPrice: new Prisma.Decimal(row.costPrice),
              sellingPrice: new Prisma.Decimal(row.sellingPrice),
              stockQuantity: new Prisma.Decimal(row.stockQuantity),
              minStockThreshold: new Prisma.Decimal(row.minStockThreshold),
            },
          });

          // If initial stock > 0, record movement
          if (row.stockQuantity > 0) {
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                quantity: new Prisma.Decimal(row.stockQuantity),
                previousQty: new Prisma.Decimal(0),
                newQty: new Prisma.Decimal(row.stockQuantity),
                movementType: MovementType.INITIAL_STOCK,
                reference: `IMPORT-${job.id}`,
                reason: 'Bulk CSV Initial Import',
                userId,
              },
            });
          }

          importedCount++;
        });
      } catch (err: any) {
        rowErrors.push(`Row ${row.rowNumber} (${row.sku}): ${err.message}`);
      }
    }

    const finalStatus =
      importedCount === 0 && rowErrors.length > 0
        ? ImportStatus.FAILED
        : rowErrors.length > 0
          ? ImportStatus.PARTIAL
          : ImportStatus.SUCCESS;

    await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        importedRows: importedCount,
        failedRows: rowErrors.length,
        status: finalStatus,
        errorsJson: JSON.stringify(rowErrors),
      },
    });

    return {
      jobId: job.id,
      totalRows: rows.length + errors.length,
      importedRows: importedCount,
      failedRows: rowErrors.length,
      status: finalStatus,
      errors: rowErrors,
    };
  }

  async getImportHistory() {
    return this.prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }
}
