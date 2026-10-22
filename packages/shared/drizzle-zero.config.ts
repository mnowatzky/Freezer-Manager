import { drizzleZeroConfig } from "drizzle-zero";
import * as drizzleSchema from "./src/db-schema";

// Only app tables (+ public user fields) are synced; auth internals stay server-side.
export default drizzleZeroConfig(drizzleSchema, {
  tables: {
    user: { id: true, name: true, email: true },
    session: false,
    account: false,
    verification: false,
    freezer: true,
    freezerMember: true,
    drawer: true,
    item: true,
    foodSuggestion: true,
    invite: true,
    pushSubscription: false,
    expiryNotice: false,
  },
});
