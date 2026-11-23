/**
 * Canonical externally reachable origin for pairing scripts and desktop launch
 * configurations. Never trust client-supplied X-Forwarded-Host/Proto headers:
 * the owner gateway has already validated the request Host and approved the
 * configured public origin.
 */
export function getTrustedNexusOrigin(request: Request): string {
  const configured = process.env.NEXUS_PUBLIC_ORIGIN?.trim()
  if (configured) {
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.origin !== configured) {
      throw new Error('Invalid NEXUS_PUBLIC_ORIGIN')
    }
    return url.origin
  }

  const url = new URL(request.url)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.protocol !== 'http:') {
    throw new Error('A trusted NEXUS_PUBLIC_ORIGIN is required for non-local device pairing')
  }
  return url.origin
}
