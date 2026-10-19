import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Category name already exists');
    return this.prisma.category.create({ data: dto });
  }

  async findAll() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!cat) throw new NotFoundException('Category not found');
    if (cat._count.products > 0) {
      throw new ConflictException(`Cannot delete: ${cat._count.products} products use this category`);
    }
    return this.prisma.category.delete({ where: { id } });
  }
}
