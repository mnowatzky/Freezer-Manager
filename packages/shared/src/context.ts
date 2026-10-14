import type { Schema } from "./zero-schema.gen";

// Trusted per-request context. On the server it is built from the validated
// Better Auth session; the client passes the same shape for optimistic runs.
export type ZeroContext = { userID: string };

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    schema: Schema;
    context: ZeroContext;
  }
}
