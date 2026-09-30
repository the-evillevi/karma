const safeCodes = new Set([
  '42501', 'PGRST301', 'DEVICE_REVOKED', 'LEASE_EXPIRED', 'AUTHORIZATION_UNAVAILABLE',
  '23505', 'COMMAND_CONFLICT', 'EVENT_CONFLICT',
]);

/** @param {unknown} error */
export function safeDiagnostic(error) {
  const candidate = typeof error === 'object' && error !== null ? error : {};
  const code = typeof candidate.code === 'string' && safeCodes.has(candidate.code) ? candidate.code : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  if (name === 'QuotaExceededError' || name === 'AbortError' || name === 'ConstraintError') {
    return { kind: 'storage', code: name, message: 'No se pudo guardar localmente. Revisa el almacenamiento disponible y vuelve a intentar.', retryable: true };
  }
  if (['42501', 'PGRST301', 'DEVICE_REVOKED', 'LEASE_EXPIRED', 'AUTHORIZATION_UNAVAILABLE'].includes(code)) {
    return { kind: 'permission', code, message: 'El servidor rechazó esta autorización. Actualiza los permisos antes de continuar.', retryable: false };
  }
  if (['23505', 'COMMAND_CONFLICT', 'EVENT_CONFLICT'].includes(code)) {
    return { kind: 'conflict', code, message: 'El servidor encontró un conflicto con un comando existente. No se aplicó el cambio.', retryable: false };
  }
  if (name === 'TypeError' || name === 'FetchError' || candidate.status === 0) {
    return { kind: 'offline', code: 'NETWORK_UNAVAILABLE', message: 'No hay conexión con el servidor. La captura local puede continuar si este dispositivo conserva una autorización vigente.', retryable: true };
  }
  if (Number.isInteger(candidate.status) && candidate.status >= 500 && candidate.status <= 599) {
    return { kind: 'server', code: `HTTP_${candidate.status}`, message: 'El servidor no pudo completar la solicitud. Conserva el comando local e inténtalo más tarde.', retryable: true };
  }
  return { kind: 'unknown', code: 'UNCLASSIFIED', message: 'La operación no se completó. Conserva el estado local y solicita revisión si el problema continúa.', retryable: false };
}
