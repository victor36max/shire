/**
 * Navigate using React Router.
 * This is a thin wrapper that components can import.
 * In the SPA, actual navigation is done via useNavigate() from react-router-dom.
 * This file exists for backward compatibility with components that import navigate().
 */

let _navigate: ((href: string, opts?: { replace?: boolean }) => void) | null = null;

export function setNavigate(fn: (href: string, opts?: { replace?: boolean }) => void): void {
  _navigate = fn;
}

export function navigate(href: string, opts?: { replace?: boolean }): void {
  if (_navigate) {
    _navigate(href, opts);
  } else {
    window.location.assign(href);
  }
}
