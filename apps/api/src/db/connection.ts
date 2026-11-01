import mongoose from "mongoose";
import type { Logger } from "@venue/core";

export async function connectMongo(uri: string, logger: Logger): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    retryWrites: true,
  });

  await assertTransactionsAvailable(logger);
  await mongoose.syncIndexes();

  logger.info("MongoDB connected");
  return mongoose;
}

/**
 * The ledger keeps the cached balance and the ledger entry in step by writing
 * them in one transaction. Transactions need a replica set — a plain standalone
 * `mongod` silently is not one.
 *
 * Checking at boot turns "the numbers drifted apart three weeks ago and nobody
 * noticed" into "the server refused to start on day one".
 */
async function assertTransactionsAvailable(logger: Logger): Promise<void> {
  const admin = mongoose.connection.db?.admin();
  if (!admin) throw new Error("MongoDB connection has no database handle.");

  const info = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
  const isReplicaSet = Boolean(info.setName);
  const isSharded = info.msg === "isdbgrid";

  if (isReplicaSet || isSharded) {
    logger.info("MongoDB supports transactions", { replicaSet: info.setName ?? "sharded" });
    return;
  }

  throw new Error(
    [
      "This MongoDB is a standalone server, which cannot run transactions.",
      "The credit ledger needs them to keep the balance and the ledger entries consistent.",
      "",
      "Local fix — run a one-node replica set:",
      "  docker compose up -d",
      "  docker compose exec mongo mongosh --eval 'rs.initiate()'",
      "  MONGODB_URI=mongodb://localhost:27017/venue-access?replicaSet=rs0",
      "",
      "MongoDB Atlas (including the free M0 tier) is already a replica set.",
    ].join("\n"),
  );
}
