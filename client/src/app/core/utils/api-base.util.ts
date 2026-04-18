export function apiBase(): string {
  const { protocol, hostname, port } = window.location;

  // Локальна розробка — явний порт бекенду
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//localhost:4000/api`;
  }

  // LAN IP (192.168.x.x, 10.x.x.x) — бекенд на :4000
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return `${protocol}//${hostname}:4000/api`;
  }

  // GitHub Codespaces (порт в субдомені: name-3000.app.github.dev → name-4000.app.github.dev)
  if (hostname.includes('.app.github.dev') || hostname.includes('.preview.app.github.dev')) {
    const apiHost = hostname.replace(/-(\d+)\./, (_: string, p: string) =>
      p === '3000' ? '-4000.' : `-${p}.`,
    );
    return `${protocol}//${apiHost}/api`;
  }

  // Production (Fly.io, custom domain) - NestJS роздає Angular зі того ж хоста
  // API на /api - без зміни хоста чи порту
  return `${protocol}//${hostname}${port ? ':' + port : ''}/api`;
}

export function wsBase(): string {
  const { protocol, hostname, port } = window.location;
  const isSecure = protocol === 'https:';

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:4000';
  }

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return `http://${hostname}:4000`;
  }

  if (hostname.includes('.app.github.dev') || hostname.includes('.preview.app.github.dev')) {
    const apiHost = hostname.replace(/-(\d+)\./, (_: string, p: string) =>
      p === '3000' ? '-4000.' : `-${p}.`,
    );
    return `https://${apiHost}`;
  }

  // Production - WSS на тому ж хості (Fly.io обробляє TLS termination)
  const wsProtocol = isSecure ? 'https' : 'http';
  return `${wsProtocol}://${hostname}${port ? ':' + port : ''}`;
}
