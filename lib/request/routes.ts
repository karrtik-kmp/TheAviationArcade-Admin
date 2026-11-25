/**
 * The Admin's API route table: every route with its audience, and the handlers. The router
 * (router.ts) has already resolved the principal, applied the account fence and the audience,
 * and checked the origin of mutations before a handler runs. Every desk is on the game backend; the
 * routes live in the *-routes.ts files. Relative imports only, so the table loads under `node --test`.
 */
import type { Route } from "./router.ts";
import { roleRoutes } from "./role-routes.ts";
import { mediaRoutes } from "./media-routes.ts";
import { militaryRoutes } from "./military-routes.ts";
import { identifierRoutes } from "./identifier-routes.ts";
import { auditRoutes } from "./audit-routes.ts";
import { potdRoutes } from "./potd-routes.ts";
import { storeRoutes } from "./store-routes.ts";
import { storePurchaseRoutes } from "./store-purchase-routes.ts";

/** Literal paths come before parameter paths that could match them. */
export const routes: Route[] = [
  ...roleRoutes,
  ...militaryRoutes,
  ...identifierRoutes,
  ...auditRoutes,
  ...potdRoutes,
  ...mediaRoutes,
  ...storeRoutes,
  ...storePurchaseRoutes,
];
