import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const username = "admin1";
  const email = "admin1@request.local";
  const password = "admin1234";

  const role = await prisma.role.findUnique({
    where: { code: "system_admin" },
  });

  if (!role) {
    throw new Error(
      "Role system_admin not found. Run `pnpm run db:seed` first."
    );
  }

  const passwordHash = await argon2.hash(password);

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      email,
      passwordHash,
      status: "active",
      deletedAt: null,
    },
    create: {
      username,
      email,
      passwordHash,
      status: "active",
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  });

  console.log({
    event: "admin_created",
    username,
    email,
    role: role.code,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });