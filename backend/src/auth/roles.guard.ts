import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../common/env';

export type Role = 'ADMIN' | 'AUDITOR';
export const ROLES_KEY = 'roles';

/** Decorador: @Roles('ADMIN') sobre un endpoint. Equivale a @PreAuthorize en Spring Security. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * v1: API key por rol en el header x-api-key. Suficiente para desarrollo local.
 * v2: reemplazar por Keycloak + JWT (el rol vendría en el token, como en RBAC).
 * La interfaz (@Roles) no cambia: solo cambia cómo se obtiene el rol.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true; // endpoint público (flujo del votante)

    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    const role: Role | null = key === env.adminKey ? 'ADMIN' : key === env.auditorKey ? 'AUDITOR' : null;
    if (!role || !required.includes(role)) throw new UnauthorizedException('Rol no autorizado');
    req.role = role;
    return true;
  }
}
