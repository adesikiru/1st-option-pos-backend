import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Type } from 'class-validator';
import { MovementType } from '@prisma/client';

export class StockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  quantity: number; // positive to add, negative to deduct

  // Frontend sends 'type', backend historically used 'movementType' - accept both
  @IsEnum(MovementType)
  @IsOptional()
  movementType?: MovementType;

  @IsEnum(MovementType)
  @IsOptional()
  type?: MovementType;

  @IsString()
  @IsOptional()
  reason?: string;

  // Computed from either movementType or type
  get resolvedMovementType(): MovementType {
    return this.movementType ?? this.type ?? MovementType.MANUAL_ADJUSTMENT;
  }
}

export class StockMovementsQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  movementType?: MovementType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  offset?: number;
}
