import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { MovementType } from '@prisma/client';

export class StockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  quantity: number; // positive to add, negative to deduct

  @IsEnum(MovementType)
  movementType: MovementType; // e.g. DAMAGE_EXPIRED, MANUAL_ADJUSTMENT

  @IsString()
  @IsOptional()
  reason?: string;
}

export class StockMovementsQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  movementType?: MovementType;

  @IsOptional()
  limit?: number;

  @IsOptional()
  offset?: number;
}
