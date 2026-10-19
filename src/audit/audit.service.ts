import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: string;
    ipAddress?: string;
  }) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId,
          details: params.details,
          ipAddress: params.ipAddress,
        },
      });
    } catch (e) {
      console.error('Audit log error:', e);
    }
  }

  async findAll(query: { limit?: number; offset?: number; action?: string; resource?: string }) {
    const take = Number(query.limit) || 50;
    const skip = Number(query.offset) || 0;
    const where: any = {};
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.resource) where.resource = { contains: query.resource, mode: 'insensitive' };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
    ]);

    return { total, logs, take, skip };
  }
}
