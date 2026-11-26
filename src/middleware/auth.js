import jwt from "jsonwebtoken";
import { AppError } from "../utils/errors.js";

const getSecret = () => process.env.JWT_SECRET || "softlligence-dev-secret";

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "UNAUTHORIZED", "Missing or invalid Authorization header."));
  }

  try {
    const payload = jwt.verify(header.slice(7), getSecret());
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId ?? null,
    };
    return next();
  } catch {
    return next(new AppError(401, "INVALID_TOKEN", "Token is invalid or expired."));
  }
}

export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          403,
          "FORBIDDEN_ROLE",
          `Role '${req.user?.role || "unknown"}' is not permitted to perform this action.`
        )
      );
    }
    return next();
  };
}
