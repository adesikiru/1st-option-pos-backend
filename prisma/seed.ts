import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Admin user
  const adminEmail = 'admin@1stoption.com';
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    const passwordHash = await bcrypt.hash('Admin@1stOption2026!', 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'System Administrator',
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
      },
    });
    console.log('✅ Admin user created: admin@1stoption.com / Admin@1stOption2026!');
  } else {
    console.log('ℹ️  Admin user already exists');
  }

  // Seed categories
  const categories = ['Beverages', 'Snacks & Confectionery', 'Household Items', 'Personal Care', 'Electronics', 'Stationery', 'Groceries', 'Other'];
  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`✅ ${categories.length} categories seeded`);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
